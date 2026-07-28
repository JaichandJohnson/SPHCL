import io
import json
import os
import zipfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson import json_util
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload
from motor.motor_asyncio import AsyncIOMotorClient


SCOPES = ["https://www.googleapis.com/auth/drive"]
DEFAULT_COLLECTIONS = [
    "records",
    "datasets",
    "options",
    "panels",
    "users",
    "backup_runs",
]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _service_account_info() -> Dict[str, Any]:
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        raise RuntimeError("GOOGLE_SERVICE_ACCOUNT_JSON is not configured")

    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON"
        ) from error


def drive_service():
    credentials = service_account.Credentials.from_service_account_info(
        _service_account_info(),
        scopes=SCOPES,
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def configured_folder_id() -> str:
    folder_id = os.environ.get("GOOGLE_DRIVE_FOLDER_ID", "").strip()
    if not folder_id:
        raise RuntimeError("GOOGLE_DRIVE_FOLDER_ID is not configured")
    return folder_id


def configured_collections() -> List[str]:
    value = os.environ.get("BACKUP_COLLECTIONS", "").strip()
    if not value:
        return DEFAULT_COLLECTIONS
    return [item.strip() for item in value.split(",") if item.strip()]


async def export_database_zip(db) -> tuple[bytes, str, Dict[str, int]]:
    timestamp = utc_now().strftime("%Y-%m-%d_%H%M%S_UTC")
    filename = f"MDS_LIMS_Backup_{timestamp}.zip"
    buffer = io.BytesIO()
    counts: Dict[str, int] = {}

    with zipfile.ZipFile(
        buffer,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for collection_name in configured_collections():
            documents = await db[collection_name].find({}).to_list(length=None)
            counts[collection_name] = len(documents)

            payload = json_util.dumps(
                documents,
                ensure_ascii=False,
                indent=2,
            )
            archive.writestr(
                f"collections/{collection_name}.json",
                payload,
            )

        metadata = {
            "application": "MDS Laboratory Information Management System",
            "created_at_utc": utc_now().isoformat(),
            "database_name": os.environ.get("DB_NAME", ""),
            "collections": counts,
            "format_version": 1,
        }
        archive.writestr(
            "metadata.json",
            json.dumps(metadata, ensure_ascii=False, indent=2),
        )

    return buffer.getvalue(), filename, counts


def upload_to_drive(data: bytes, filename: str) -> Dict[str, Any]:
    service = drive_service()
    folder_id = configured_folder_id()

    media = MediaIoBaseUpload(
        io.BytesIO(data),
        mimetype="application/zip",
        resumable=True,
    )
    file = (
        service.files()
        .create(
            body={
                "name": filename,
                "parents": [folder_id],
                "description": "Automatic MDS LIMS database backup",
            },
            media_body=media,
            fields="id,name,size,createdTime,webViewLink",
            supportsAllDrives=True,
        )
        .execute()
    )
    return file


def list_drive_backups(limit: int = 20) -> List[Dict[str, Any]]:
    service = drive_service()
    folder_id = configured_folder_id()
    query = (
        f"'{folder_id}' in parents and trashed = false "
        "and name contains 'MDS_LIMS_Backup_'"
    )
    response = (
        service.files()
        .list(
            q=query,
            orderBy="createdTime desc",
            pageSize=min(max(limit, 1), 100),
            fields="files(id,name,size,createdTime,modifiedTime,webViewLink)",
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
    )
    return response.get("files", [])


def enforce_retention() -> int:
    retention_count = max(
        1,
        int(os.environ.get("BACKUP_RETENTION_COUNT", "30")),
    )
    files = list_drive_backups(limit=100)
    old_files = files[retention_count:]
    service = drive_service()

    deleted = 0
    for file in old_files:
        service.files().delete(
            fileId=file["id"],
            supportsAllDrives=True,
        ).execute()
        deleted += 1
    return deleted


async def run_backup(db, trigger: str = "scheduled") -> Dict[str, Any]:
    started_at = utc_now()
    run_id = f"backup_{started_at.strftime('%Y%m%d%H%M%S%f')}"
    run_doc: Dict[str, Any] = {
        "id": run_id,
        "trigger": trigger,
        "status": "running",
        "started_at": started_at.isoformat(),
    }
    await db.backup_runs.insert_one(run_doc.copy())

    try:
        data, filename, counts = await export_database_zip(db)
        drive_file = upload_to_drive(data, filename)
        deleted_count = enforce_retention()
        completed_at = utc_now()

        completed = {
            "status": "success",
            "completed_at": completed_at.isoformat(),
            "filename": filename,
            "size_bytes": len(data),
            "collection_counts": counts,
            "drive_file_id": drive_file.get("id"),
            "drive_url": drive_file.get("webViewLink"),
            "retention_deleted": deleted_count,
        }
        await db.backup_runs.update_one(
            {"id": run_id},
            {"$set": completed},
        )
        return {"id": run_id, **run_doc, **completed}
    except Exception as error:
        failed = {
            "status": "failed",
            "completed_at": utc_now().isoformat(),
            "error": str(error),
        }
        await db.backup_runs.update_one(
            {"id": run_id},
            {"$set": failed},
        )
        raise


async def get_backup_status(db) -> Dict[str, Any]:
    latest = await db.backup_runs.find_one(
        {},
        {"_id": 0},
        sort=[("started_at", -1)],
    )
    recent = await db.backup_runs.find(
        {},
        {"_id": 0},
    ).sort("started_at", -1).limit(10).to_list(10)

    enabled = (
        os.environ.get("ENABLE_GOOGLE_DRIVE_BACKUP", "false")
        .strip()
        .lower()
        == "true"
    )

    return {
        "enabled": enabled,
        "configured": bool(
            os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
            and os.environ.get("GOOGLE_DRIVE_FOLDER_ID")
        ),
        "schedule": os.environ.get("BACKUP_SCHEDULE_LABEL", "Daily at 02:00 IST"),
        "retention_count": int(
            os.environ.get("BACKUP_RETENTION_COUNT", "30")
        ),
        "latest": latest,
        "recent": recent,
    }


async def connect_database():
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    return client, client[db_name]
