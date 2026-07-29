import asyncio
import io
import json
import os
import secrets
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from fastapi.responses import RedirectResponse
from google.auth.transport.requests import Request as GoogleRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/drive.file",
]
_scheduler = None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def client_config():
    client_id = os.environ.get("GOOGLE_DRIVE_CLIENT_ID") or os.environ.get("GOOGLE_CLIENT_ID")
    secret = (
        os.environ.get("GOOGLE_DRIVE_CLIENT_SECRET")
        or os.environ.get("GOOGLE_CLIENT_SECRET")
    )
    redirect = os.environ.get("GOOGLE_DRIVE_REDIRECT_URI")
    if not client_id or not secret or not redirect:
        raise HTTPException(status_code=500, detail="Google Drive OAuth is not configured")
    return {
        "web": {
            "client_id": client_id,
            "client_secret": secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [redirect],
        }
    }


def cipher():
    key = os.environ.get("BACKUP_ENCRYPTION_KEY", "")
    try:
        return Fernet(key.encode())
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Invalid backup encryption key") from exc


def encrypt_credentials(credentials):
    payload = {
        "token": credentials.token,
        "refresh_token": credentials.refresh_token,
        "token_uri": credentials.token_uri,
        "client_id": credentials.client_id,
        "client_secret": credentials.client_secret,
        "scopes": list(credentials.scopes or SCOPES),
    }
    return cipher().encrypt(json.dumps(payload).encode()).decode()


def load_credentials(document):
    try:
        payload = json.loads(
            cipher().decrypt(document["encrypted_credentials"].encode()).decode()
        )
    except (InvalidToken, ValueError, KeyError) as exc:
        raise HTTPException(status_code=500, detail="Stored Drive authorization is unreadable") from exc

    credentials = Credentials(**payload)
    if credentials.expired and credentials.refresh_token:
        credentials.refresh(GoogleRequest())
    return credentials


def json_safe(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if value.__class__.__name__ == "ObjectId":
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


async def create_archive(db):
    excluded = {"user_sessions", "backup_oauth_states"}
    names = [
        name for name in await db.list_collection_names()
        if name not in excluded and not name.startswith("system.")
    ]
    collections = {}
    counts = {}
    total = 0

    for name in sorted(names):
        documents = await db[name].find({}).to_list(length=None)
        safe = [json_safe(document) for document in documents]
        collections[name] = safe
        counts[name] = len(safe)
        total += len(safe)

    metadata = {
        "application": "MDS Laboratory Information Management System",
        "version": os.environ.get("APP_VERSION", "2.2"),
        "created_at_utc": now_iso(),
        "database_name": os.environ.get("DB_NAME", ""),
        "collection_count": len(names),
        "total_documents": total,
        "collection_counts": counts,
        "excluded_collections": sorted(excluded),
    }

    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("backup.json", json.dumps({"collections": collections}, indent=2))
        archive.writestr("metadata.json", json.dumps(metadata, indent=2))
        archive.writestr("version.txt", metadata["version"])
    return stream.getvalue(), metadata


def drive_service(credentials):
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def folder_id(service):
    configured = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if configured:
        return configured

    name = os.environ.get("GOOGLE_DRIVE_FOLDER_NAME", "MDS LIMS Backups")
    escaped = name.replace("'", "\\'")
    found = service.files().list(
        q=f"name='{escaped}' and mimeType='application/vnd.google-apps.folder' and trashed=false",
        spaces="drive",
        fields="files(id,name)",
    ).execute().get("files", [])
    if found:
        return found[0]["id"]

    return service.files().create(
        body={"name": name, "mimeType": "application/vnd.google-apps.folder"},
        fields="id",
    ).execute()["id"]


def upload(credentials, data, filename):
    service = drive_service(credentials)
    folder = folder_id(service)
    media = MediaIoBaseUpload(io.BytesIO(data), mimetype="application/zip")
    created = service.files().create(
        body={"name": filename, "parents": [folder]},
        media_body=media,
        fields="id,name,size,createdTime,webViewLink",
    ).execute()
    return {"folder_id": folder, **created}


def list_files(credentials, limit=30):
    service = drive_service(credentials)
    folder = folder_id(service)
    files = service.files().list(
        q=f"'{folder}' in parents and trashed=false and name contains 'MDS_LIMS_Backup_'",
        orderBy="createdTime desc",
        pageSize=min(max(limit, 1), 100),
        fields="files(id,name,size,createdTime,webViewLink)",
    ).execute().get("files", [])
    return files


def apply_retention(credentials):
    keep = int(os.environ.get("BACKUP_RETENTION_COUNT", "30"))
    service = drive_service(credentials)
    folder = folder_id(service)
    files = service.files().list(
        q=f"'{folder}' in parents and trashed=false and name contains 'MDS_LIMS_Backup_'",
        orderBy="createdTime desc",
        pageSize=100,
        fields="files(id,name,createdTime)",
    ).execute().get("files", [])
    for item in files[keep:]:
        service.files().delete(fileId=item["id"]).execute()
    return max(0, len(files) - keep)


async def perform_backup(db, trigger):
    document = await db.backup_settings.find_one({"key": "google_drive"}, {"_id": 0})
    if not document or not document.get("encrypted_credentials"):
        raise HTTPException(status_code=409, detail="Google Drive is not connected")

    credentials = await asyncio.to_thread(load_credentials, document)
    archive, metadata = await create_archive(db)
    filename = f"MDS_LIMS_Backup_{datetime.now(timezone.utc).strftime('%Y-%m-%d_%H%M%S')}.zip"
    uploaded = await asyncio.to_thread(upload, credentials, archive, filename)
    deleted = await asyncio.to_thread(apply_retention, credentials)

    update = {
        "last_backup_at": now_iso(),
        "last_backup_status": "success",
        "last_backup_name": filename,
        "last_backup_size": uploaded.get("size") or len(archive),
        "last_backup_trigger": trigger,
        "folder_id": uploaded.get("folder_id"),
        "last_error": None,
        "updated_at": now_iso(),
    }
    await db.backup_settings.update_one(
        {"key": "google_drive"}, {"$set": update}, upsert=True
    )
    await db.backup_logs.insert_one({
        "id": secrets.token_hex(8),
        "created_at": now_iso(),
        "status": "success",
        "trigger": trigger,
        "filename": filename,
        "size": update["last_backup_size"],
        "metadata": metadata,
        "retention_deleted": deleted,
    })
    return {"ok": True, "filename": filename, "file": uploaded, "metadata": metadata}


async def scheduled_backup(db):
    if os.environ.get("ENABLE_GOOGLE_DRIVE_BACKUP", "false").lower() != "true":
        return
    try:
        await perform_backup(db, "scheduled")
    except Exception as exc:
        await db.backup_settings.update_one(
            {"key": "google_drive"},
            {"$set": {
                "last_backup_at": now_iso(),
                "last_backup_status": "failed",
                "last_error": str(exc),
                "updated_at": now_iso(),
            }},
            upsert=True,
        )


def register_backup(app, router, db, get_current_user):
    from fastapi import Depends, Request
    from apscheduler.triggers.cron import CronTrigger

    @router.get("/backup/google/connect-url")
    async def connect_url(user=Depends(get_current_user)):
        state = secrets.token_urlsafe(32)
        await db.backup_oauth_states.insert_one({
            "state": state,
            "user_id": user["user_id"],
            "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat(),
        })
        flow = Flow.from_client_config(
            client_config(),
            scopes=SCOPES,
            redirect_uri=os.environ["GOOGLE_DRIVE_REDIRECT_URI"],
        )
        url, _ = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state=state,
        )
        return {"authorization_url": url}

    @router.get("/backup/google/callback")
    async def callback(request: Request, code: str, state: str):
        state_doc = await db.backup_oauth_states.find_one({"state": state}, {"_id": 0})
        if not state_doc:
            raise HTTPException(status_code=400, detail="Invalid OAuth state")

        expires = datetime.fromisoformat(state_doc["expires_at"])
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="OAuth state expired")

        flow = Flow.from_client_config(
            client_config(),
            scopes=SCOPES,
            redirect_uri=os.environ["GOOGLE_DRIVE_REDIRECT_URI"],
            state=state,
        )
        flow.fetch_token(code=code)
        credentials = flow.credentials

        previous = await db.backup_settings.find_one({"key": "google_drive"}, {"_id": 0})
        if not credentials.refresh_token and previous:
            old = load_credentials(previous)
            credentials.refresh_token = old.refresh_token
        if not credentials.refresh_token:
            raise HTTPException(status_code=400, detail="Google did not return a refresh token")

        await db.backup_settings.update_one(
            {"key": "google_drive"},
            {"$set": {
                "key": "google_drive",
                "connected": True,
                "connected_by_user_id": state_doc["user_id"],
                "encrypted_credentials": encrypt_credentials(credentials),
                "connected_at": now_iso(),
                "updated_at": now_iso(),
            }},
            upsert=True,
        )
        await db.backup_oauth_states.delete_one({"state": state})
        frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
        return RedirectResponse(f"{frontend}/backup?drive=connected")

    @router.get("/backup/status")
    async def status(user=Depends(get_current_user)):
        document = await db.backup_settings.find_one(
            {"key": "google_drive"},
            {"_id": 0, "encrypted_credentials": 0},
        )
        return {
            "connected": bool(document and document.get("connected")),
            "automatic_enabled": os.environ.get(
                "ENABLE_GOOGLE_DRIVE_BACKUP", "false"
            ).lower() == "true",
            "schedule": (
                f"{int(os.environ.get('BACKUP_HOUR', '2')):02d}:"
                f"{int(os.environ.get('BACKUP_MINUTE', '0')):02d}"
            ),
            "timezone": os.environ.get("BACKUP_TIMEZONE", "Asia/Kolkata"),
            "retention_count": int(os.environ.get("BACKUP_RETENTION_COUNT", "30")),
            **(document or {}),
        }

    @router.get("/backup/history")
    async def history(limit: int = 30, user=Depends(get_current_user)):
        document = await db.backup_settings.find_one({"key": "google_drive"}, {"_id": 0})
        if not document:
            return {"items": []}
        credentials = await asyncio.to_thread(load_credentials, document)
        files = await asyncio.to_thread(list_files, credentials, limit)
        return {"items": files}

    @router.post("/backup/run")
    async def run(user=Depends(get_current_user)):
        return await perform_backup(db, "manual")

    @router.post("/backup/disconnect")
    async def disconnect(user=Depends(get_current_user)):
        await db.backup_settings.delete_one({"key": "google_drive"})
        return {"ok": True}

    @app.on_event("startup")
    async def start_scheduler():
        global _scheduler
        if _scheduler:
            return
        timezone_name = os.environ.get("BACKUP_TIMEZONE", "Asia/Kolkata")
        _scheduler = AsyncIOScheduler(timezone=timezone_name)
        _scheduler.add_job(
            scheduled_backup,
            CronTrigger(
                hour=int(os.environ.get("BACKUP_HOUR", "2")),
                minute=int(os.environ.get("BACKUP_MINUTE", "0")),
                timezone=timezone_name,
            ),
            args=[db],
            id="mds_drive_backup",
            replace_existing=True,
            max_instances=1,
            coalesce=True,
        )
        _scheduler.start()

    @app.on_event("shutdown")
    async def stop_scheduler():
        global _scheduler
        if _scheduler:
            _scheduler.shutdown(wait=False)
            _scheduler = None
