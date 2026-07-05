from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import logging
import uuid
import httpx
import pandas as pd
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Constants: Kerala Districts (default seed) ----------
KERALA_DISTRICTS = [
    "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha", "Kottayam",
    "Idukki", "Ernakulam", "Thrissur", "Palakkad", "Malappuram",
    "Kozhikode", "Wayanad", "Kannur", "Kasaragod",
]
DEFAULT_TESTS = ["RT-PCR SARS-CoV-2", "Dengue NS1", "H1N1 RT-PCR", "HIV Viral Load", "HCV RNA", "HBV DNA", "Tuberculosis PCR"]
DEFAULT_SAMPLE_TYPES = ["Nasopharyngeal Swab", "Oropharyngeal Swab", "Serum", "Plasma", "Whole Blood", "CSF", "Urine", "Sputum"]

# ---------- Models ----------
class ResultItem(BaseModel):
    name: str
    value: str

class LabRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    lab_number: str
    date: str  # ISO date "YYYY-MM-DD"
    name: str
    age: Optional[int] = None
    district: str
    test: str
    sample_type: str
    results: List[ResultItem] = Field(default_factory=list)
    result_date: Optional[str] = None
    remarks: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class LabRecordCreate(BaseModel):
    lab_number: str
    date: str
    name: str
    age: Optional[int] = None
    district: str
    test: str
    sample_type: str
    results: List[ResultItem] = []
    result_date: Optional[str] = None
    remarks: Optional[str] = None

class LabRecordUpdate(BaseModel):
    lab_number: Optional[str] = None
    date: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None
    district: Optional[str] = None
    test: Optional[str] = None
    sample_type: Optional[str] = None
    results: Optional[List[ResultItem]] = None
    result_date: Optional[str] = None
    remarks: Optional[str] = None

class BulkResultPayload(BaseModel):
    ids: List[str]
    results: List[ResultItem]
    result_date: Optional[str] = None

class OptionItem(BaseModel):
    type: str  # 'test' | 'district' | 'sample_type'
    value: str

# ---------- Helpers ----------
def _serialize_record(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    for k in ("created_at", "updated_at"):
        v = doc.get(k)
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    return doc

async def get_current_user(request: Request):
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")

    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")

    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ---------- Startup: seed dropdown options ----------
@app.on_event("startup")
async def seed_defaults():
    # Seed option collections if empty
    if await db.options.count_documents({"type": "district"}) == 0:
        await db.options.insert_many([{"type": "district", "value": d} for d in KERALA_DISTRICTS])
    if await db.options.count_documents({"type": "test"}) == 0:
        await db.options.insert_many([{"type": "test", "value": t} for t in DEFAULT_TESTS])
    if await db.options.count_documents({"type": "sample_type"}) == 0:
        await db.options.insert_many([{"type": "sample_type", "value": s} for s in DEFAULT_SAMPLE_TYPES])

# ---------- Auth Routes ----------
@api_router.post("/auth/session")
async def create_session(request: Request, response: Response):
    body = await request.json()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="Missing session_id")

    async with httpx.AsyncClient(timeout=15) as h:
        r = await h.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid session_id")
        data = r.json()

    email = data["email"]
    name = data["name"]
    picture = data.get("picture", "")
    session_token = data["session_token"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one({"user_id": user_id}, {"$set": {"name": name, "picture": picture}})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    response.set_cookie(
        key="session_token",
        value=session_token,
        max_age=7 * 24 * 60 * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )
    return {"user_id": user_id, "email": email, "name": name, "picture": picture}

@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return {"user_id": user["user_id"], "email": user["email"], "name": user["name"], "picture": user.get("picture", "")}

@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if token:
        await db.user_sessions.delete_one({"session_token": token})
    response.delete_cookie("session_token", path="/", samesite="none", secure=True)
    return {"ok": True}

# ---------- Options ----------
@api_router.get("/options")
async def list_options(user=Depends(get_current_user)):
    docs = await db.options.find({}, {"_id": 0}).to_list(5000)
    grouped = {"test": [], "district": [], "sample_type": []}
    for d in docs:
        grouped.setdefault(d["type"], []).append(d["value"])
    for k in grouped:
        grouped[k] = sorted(set(grouped[k]))
    return grouped

@api_router.post("/options")
async def add_option(item: OptionItem, user=Depends(get_current_user)):
    if item.type not in ("test", "district", "sample_type"):
        raise HTTPException(status_code=400, detail="Invalid type")
    val = item.value.strip()
    if not val:
        raise HTTPException(status_code=400, detail="Empty value")
    existing = await db.options.find_one({"type": item.type, "value": val})
    if not existing:
        await db.options.insert_one({"type": item.type, "value": val})
    return {"ok": True}

@api_router.delete("/options")
async def delete_option(type: str, value: str, user=Depends(get_current_user)):
    await db.options.delete_one({"type": type, "value": value})
    return {"ok": True}

# ---------- Records CRUD ----------
def _apply_filters(query: dict, test: Optional[str], district: Optional[str], sample_type: Optional[str],
                   result_contains: Optional[str], search: Optional[str],
                   date_from: Optional[str], date_to: Optional[str]):
    if test:
        query["test"] = test
    if district:
        query["district"] = district
    if sample_type:
        query["sample_type"] = sample_type
    if result_contains:
        query["results.value"] = {"$regex": result_contains, "$options": "i"}
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"lab_number": {"$regex": search, "$options": "i"}},
        ]
    if date_from or date_to:
        dq = {}
        if date_from:
            dq["$gte"] = date_from
        if date_to:
            dq["$lte"] = date_to
        query["date"] = dq

@api_router.post("/records", response_model=LabRecord)
async def create_record(payload: LabRecordCreate, user=Depends(get_current_user)):
    rec = LabRecord(**payload.model_dump(), created_by=user["user_id"])
    doc = rec.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = doc["updated_at"].isoformat()
    await db.records.insert_one(doc)
    return rec

@api_router.get("/records")
async def list_records(
    test: Optional[str] = None, district: Optional[str] = None, sample_type: Optional[str] = None,
    result_contains: Optional[str] = None, search: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    pending: Optional[bool] = None,
    page: int = 1, page_size: int = 25,
    user=Depends(get_current_user),
):
    query: dict = {}
    _apply_filters(query, test, district, sample_type, result_contains, search, date_from, date_to)
    if pending is True:
        query["$or"] = query.get("$or", []) + [{"results": {"$size": 0}}, {"results": {"$exists": False}}]
    if pending is False:
        query["results.0"] = {"$exists": True}

    total = await db.records.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    cursor = db.records.find(query, {"_id": 0}).sort("date", -1).skip(skip).limit(page_size)
    items = await cursor.to_list(page_size)
    for it in items:
        _serialize_record(it)
    return {"total": total, "page": page, "page_size": page_size, "items": items}

@api_router.get("/records/{rid}")
async def get_record(rid: str, user=Depends(get_current_user)):
    doc = await db.records.find_one({"id": rid}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return _serialize_record(doc)

@api_router.put("/records/{rid}")
async def update_record(rid: str, payload: LabRecordUpdate, user=Depends(get_current_user)):
    update = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = datetime.now(timezone.utc).isoformat()
    if "results" in update:
        update["results"] = [r if isinstance(r, dict) else r.model_dump() for r in update["results"]]
    result = await db.records.update_one({"id": rid}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    doc = await db.records.find_one({"id": rid}, {"_id": 0})
    return _serialize_record(doc)

@api_router.delete("/records/{rid}")
async def delete_record(rid: str, user=Depends(get_current_user)):
    await db.records.delete_one({"id": rid})
    return {"ok": True}

# ---------- Bulk result apply ----------
@api_router.post("/records/bulk-result")
async def bulk_result(payload: BulkResultPayload, user=Depends(get_current_user)):
    if not payload.ids:
        raise HTTPException(status_code=400, detail="No ids provided")
    set_doc = {
        "results": [r.model_dump() for r in payload.results],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if payload.result_date:
        set_doc["result_date"] = payload.result_date
    res = await db.records.update_many({"id": {"$in": payload.ids}}, {"$set": set_doc})
    return {"matched": res.matched_count, "modified": res.modified_count}

# ---------- CSV Import ----------
@api_router.post("/records/import")
async def import_csv(file: UploadFile = File(...), user=Depends(get_current_user)):
    content = await file.read()
    try:
        if file.filename.lower().endswith(".xlsx") or file.filename.lower().endswith(".xls"):
            df = pd.read_excel(io.BytesIO(content))
        else:
            df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse error: {e}")

    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    required = {"lab_number", "date", "name", "district", "test", "sample_type"}
    missing = required - set(df.columns)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {sorted(missing)}")

    inserted = 0
    errors = []
    now_iso = datetime.now(timezone.utc).isoformat()
    for idx, row in df.iterrows():
        try:
            results_list = []
            # Support result_1, result_2 columns or single result column
            for col in df.columns:
                if col.startswith("result") and col not in ("result_date",):
                    val = row.get(col)
                    if pd.notna(val) and str(val).strip() != "":
                        results_list.append({"name": col, "value": str(val)})
            age_val = row.get("age")
            try:
                age = int(age_val) if pd.notna(age_val) and str(age_val).strip() != "" else None
            except Exception:
                age = None
            rec = {
                "id": str(uuid.uuid4()),
                "lab_number": str(row["lab_number"]),
                "date": str(row["date"])[:10],
                "name": str(row["name"]),
                "age": age,
                "district": str(row["district"]),
                "test": str(row["test"]),
                "sample_type": str(row["sample_type"]),
                "results": results_list,
                "result_date": (str(row["result_date"])[:10] if "result_date" in df.columns and pd.notna(row.get("result_date")) else None),
                "remarks": (str(row["remarks"]) if "remarks" in df.columns and pd.notna(row.get("remarks")) else None),
                "created_by": user["user_id"],
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            await db.records.insert_one(rec)
            inserted += 1
        except Exception as e:
            errors.append({"row": int(idx) + 2, "error": str(e)})
    return {"inserted": inserted, "errors": errors[:20]}

# ---------- Export ----------
def _flatten_record(r: dict) -> dict:
    out = {
        "Lab Number": r.get("lab_number", ""),
        "Date": r.get("date", ""),
        "Name": r.get("name", ""),
        "Age": r.get("age", ""),
        "District": r.get("district", ""),
        "Test": r.get("test", ""),
        "Sample Type": r.get("sample_type", ""),
        "Result Date": r.get("result_date", ""),
        "Remarks": r.get("remarks", ""),
    }
    for i, res in enumerate(r.get("results", []) or [], start=1):
        out[f"Result {i} Name"] = res.get("name", "")
        out[f"Result {i} Value"] = res.get("value", "")
    return out

@api_router.get("/export")
async def export_records(
    format: str = "csv",
    test: Optional[str] = None, district: Optional[str] = None, sample_type: Optional[str] = None,
    result_contains: Optional[str] = None, search: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    query: dict = {}
    _apply_filters(query, test, district, sample_type, result_contains, search, date_from, date_to)
    cursor = db.records.find(query, {"_id": 0}).sort("date", -1)
    items = await cursor.to_list(100000)
    rows = [_flatten_record(r) for r in items]
    df = pd.DataFrame(rows)

    if format == "xlsx":
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="LabRecords")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=lab_records_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"},
        )
    else:
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=lab_records_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"},
        )

# ---------- Stats ----------
@api_router.get("/stats")
async def stats(user=Depends(get_current_user)):
    total = await db.records.count_documents({})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_count = await db.records.count_documents({"date": today})
    pending = await db.records.count_documents({"$or": [{"results": {"$size": 0}}, {"results": {"$exists": False}}]})
    districts = len(await db.records.distinct("district"))
    tests_agg = await db.records.aggregate([
        {"$group": {"_id": "$test", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]).to_list(5)
    return {
        "total": total,
        "today": today_count,
        "pending": pending,
        "districts": districts,
        "top_tests": [{"test": t["_id"], "count": t["count"]} for t in tests_agg],
    }

# ---------- Root health ----------
@api_router.get("/")
async def root():
    return {"service": "SPHCL Molecular Diagnosis - Lab Data Management"}

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
