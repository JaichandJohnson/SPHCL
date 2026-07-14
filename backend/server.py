from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import ReturnDocument
import os
import io
import logging
import uuid
import httpx
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import pandas as pd
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Constants ----------
KERALA_DISTRICTS = [
    "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
    "Kottayam", "Idukki", "Ernakulam", "Thrissur", "Palakkad",
    "Malappuram", "Kozhikode", "Wayanad", "Kannur", "Kasaragod",
]

DEFAULT_SAMPLE_TYPES = [
    "Nasopharyngeal Swab", "Oropharyngeal Swab", "Serum", "Plasma",
    "Whole Blood", "CSF", "Urine", "Sputum",
]

DEFAULT_DATASETS = [
    {"key": "routine", "name": "Routine", "prefix": "MDS", "next_number": 1, "active": True},
    {"key": "mr_surveillance", "name": "MR Surveillance", "prefix": "MR", "next_number": 1, "active": True},
    {"key": "diphtheria", "name": "Diphtheria", "prefix": "WD", "next_number": 1, "active": True},
    {"key": "pertussis", "name": "Pertussis", "prefix": "WP", "next_number": 1, "active": True},
    {"key": "rabies", "name": "Rabies", "prefix": "R", "next_number": 1, "active": True},
    {"key": "fla", "name": "FLA", "prefix": "FLA", "next_number": 1, "active": True},
    {"key": "special_serology", "name": "Special Serology", "prefix": "VPD", "next_number": 1, "active": True},
]

DEFAULT_TESTS_BY_DATASET = {
    "routine": ["RT-PCR SARS-CoV-2", "Dengue NS1", "H1N1 RT-PCR", "HIV Viral Load", "HCV RNA", "HBV DNA", "Tuberculosis PCR"],
    "mr_surveillance": ["Measles IgM", "Rubella IgM", "Measles RT-PCR", "Rubella RT-PCR"],
    "diphtheria": ["Diphtheria Culture", "Diphtheria PCR"],
    "pertussis": ["Pertussis PCR", "Pertussis Culture"],
    "rabies": ["Rabies DFA", "Rabies PCR", "Rabies Antibody"],
    "fla": ["FLA Microscopy", "FLA PCR", "Acanthamoeba PCR", "Naegleria PCR"],
    "special_serology": ["VPD Serology", "Varicella IgM", "Mumps IgM", "JE IgM"],
}

VALID_RESULT_VALUES = {"", "Positive", "Negative", "Indeterminate", "Pending"}

# ---------- Models ----------
class ResultItem(BaseModel):
    """Backward-compatible old result item."""
    name: str
    value: Optional[str] = None


class TestResultItem(BaseModel):
    test: str
    result1: Optional[str] = None
    result2: Optional[str] = None
    result_date: Optional[str] = None


class DatasetMaster(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str
    name: str
    prefix: str
    next_number: int = 1
    active: bool = True
    tests: List[str] = Field(default_factory=list)
    sample_types: List[str] = Field(default_factory=list)


class LabRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    dataset: str = "routine"
    lab_number: str = ""
    date: str
    name: str
    age: Optional[int] = None
    district: str
    sample_type: str
    tests: List[TestResultItem] = Field(default_factory=list)
    remarks: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Old fields retained so older frontend/export code does not immediately fail.
    test: Optional[str] = None
    results: List[ResultItem] = Field(default_factory=list)
    result_date: Optional[str] = None


class LabRecordCreate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    dataset: str = "routine"
    lab_number: Optional[str] = None
    date: str
    name: str
    age: Optional[int] = None
    district: str
    sample_type: str
    tests: List[TestResultItem] = Field(default_factory=list)
    remarks: Optional[str] = None

    # Backward-compatible old fields.
    test: Optional[str] = None
    results: List[ResultItem] = Field(default_factory=list)
    result_date: Optional[str] = None


class LabRecordUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    dataset: Optional[str] = None
    lab_number: Optional[str] = None
    date: Optional[str] = None
    name: Optional[str] = None
    age: Optional[int] = None
    district: Optional[str] = None
    sample_type: Optional[str] = None
    tests: Optional[List[TestResultItem]] = None
    remarks: Optional[str] = None

    # Backward-compatible old fields.
    test: Optional[str] = None
    results: Optional[List[ResultItem]] = None
    result_date: Optional[str] = None


class BulkResultPayload(BaseModel):
    ids: List[str]
    test: str
    result1: Optional[str] = None
    result2: Optional[str] = None
    result_date: Optional[str] = None


class OptionItem(BaseModel):
    type: str  # 'test' | 'district' | 'sample_type'
    value: str
    dataset: Optional[str] = None


# ---------- Helpers ----------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_key(value: str) -> str:
    return str(value or "").strip().lower().replace(" ", "_").replace("-", "_")


def normalize_date(value: Any) -> str:
    if value is None or pd.isna(value):
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d")
    text = str(value).strip()
    if not text:
        return ""
    # Pandas often gives timestamps as strings.
    try:
        parsed = pd.to_datetime(text, errors="raise")
        return parsed.strftime("%Y-%m-%d")
    except Exception:
        return text[:10]


def _serialize_record(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    for k in ("created_at", "updated_at"):
        v = doc.get(k)
        if isinstance(v, datetime):
            doc[k] = v.isoformat()
    # Compatibility: if old record has test/results but no tests, expose a tests array.
    if not doc.get("tests"):
        legacy_test = doc.get("test")
        legacy_results = doc.get("results") or []
        if legacy_test:
            result1 = legacy_results[0].get("name") if legacy_results else None
            result2 = legacy_results[0].get("value") if legacy_results else None
            doc["tests"] = [{
                "test": legacy_test,
                "result1": result1,
                "result2": result2,
                "result_date": doc.get("result_date"),
            }]
    return doc


def _tests_from_payload(payload: LabRecordCreate | LabRecordUpdate) -> List[Dict[str, Any]]:
    data = payload.model_dump(exclude_unset=True)
    tests = data.get("tests")
    if tests:
        return [t if isinstance(t, dict) else t.model_dump() for t in tests]

    # Convert old shape into new shape when old frontend submits.
    legacy_test = data.get("test")
    legacy_results = data.get("results") or []
    result_date = data.get("result_date")
    if legacy_test:
        if legacy_results:
            first = legacy_results[0]
            if not isinstance(first, dict):
                first = first.model_dump()
            return [{
                "test": legacy_test,
                "result1": first.get("name"),
                "result2": first.get("value"),
                "result_date": result_date,
            }]
        return [{"test": legacy_test, "result1": None, "result2": None, "result_date": result_date}]
    return []


def _legacy_from_tests(tests: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep old fields populated from the first test for compatibility."""
    if not tests:
        return {"test": "", "results": [], "result_date": None}
    first = tests[0]
    return {
        "test": first.get("test", ""),
        "results": [{"name": first.get("result1") or "", "value": first.get("result2") or ""}],
        "result_date": first.get("result_date"),
    }


async def get_dataset(dataset_key_or_name: str) -> dict:
    key = normalize_key(dataset_key_or_name)
    doc = await db.datasets.find_one({"$or": [{"key": key}, {"name": dataset_key_or_name}]}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=400, detail=f"Invalid dataset: {dataset_key_or_name}")
    if doc.get("active") is False:
        raise HTTPException(status_code=400, detail=f"Dataset is inactive: {doc.get('name')}")
    return doc


async def generate_lab_number(dataset_key: str) -> str:
    ds = await get_dataset(dataset_key)
    updated = await db.datasets.find_one_and_update(
        {"key": ds["key"]},
        {"$inc": {"next_number": 1}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if updated and "next_number" in updated:
        assigned = int(updated["next_number"]) - 1
        prefix = updated.get("prefix", ds["prefix"])
    else:
        # Fallback should rarely be used.
        await db.datasets.update_one({"key": ds["key"]}, {"$inc": {"next_number": 1}})
        assigned = int(ds.get("next_number", 1))
        prefix = ds["prefix"]
    return f"{prefix} {assigned}"


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


# ---------- Startup ----------
@app.on_event("startup")
async def seed_defaults():
    # Dataset master.
    for ds in DEFAULT_DATASETS:
        existing = await db.datasets.find_one({"key": ds["key"]})
        if not existing:
            await db.datasets.insert_one(ds.copy())
        else:
            await db.datasets.update_one(
                {"key": ds["key"]},
                {"$set": {"name": ds["name"], "prefix": ds["prefix"], "active": existing.get("active", True)}},
            )

    # Master options.
    if await db.options.count_documents({"type": "district"}) == 0:
        await db.options.insert_many([{"type": "district", "value": d} for d in KERALA_DISTRICTS])

    if await db.options.count_documents({"type": "sample_type"}) == 0:
        await db.options.insert_many([{"type": "sample_type", "value": s} for s in DEFAULT_SAMPLE_TYPES])

    for dataset, tests in DEFAULT_TESTS_BY_DATASET.items():
        for test in tests:
            if not await db.options.find_one({"type": "test", "dataset": dataset, "value": test}):
                await db.options.insert_one({"type": "test", "dataset": dataset, "value": test})

    # Helpful indexes.
    await db.records.create_index("id", unique=True)
    await db.records.create_index("lab_number")
    await db.records.create_index("date")
    await db.records.create_index("dataset")
    await db.records.create_index("tests.test")
    await db.datasets.create_index("key", unique=True)


# ---------- Auth Routes ----------
class GoogleLoginPayload(BaseModel):
    credential: str


@api_router.post("/auth/google")
async def google_login(payload: GoogleLoginPayload, response: Response):
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(status_code=500, detail="Google authentication is not configured")

    try:
        token_data = id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            client_id,
        )
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google credential")

    email = str(token_data.get("email") or "").strip().lower()
    name = str(token_data.get("name") or email).strip()
    picture = str(token_data.get("picture") or "")
    email_verified = token_data.get("email_verified", False)

    if not email or not email_verified:
        raise HTTPException(status_code=401, detail="Google email is not verified")

    allowed_domains = [
        item.strip().lower()
        for item in os.environ.get("ALLOWED_EMAIL_DOMAINS", "").split(",")
        if item.strip()
    ]
    allowed_emails = [
        item.strip().lower()
        for item in os.environ.get("ALLOWED_EMAILS", "").split(",")
        if item.strip()
    ]

    if allowed_domains or allowed_emails:
        email_domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        if email not in allowed_emails and email_domain not in allowed_domains:
            raise HTTPException(status_code=403, detail="This Google account is not authorized")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    now = now_iso()

    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "name": name,
                "picture": picture,
                "email_verified": True,
                "last_login_at": now,
            }},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "email_verified": True,
            "active": True,
            "created_at": now,
            "last_login_at": now,
        })

    session_token = uuid.uuid4().hex + uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    await db.user_sessions.delete_many({"user_id": user_id})
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": now,
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

    return {
        "user_id": user_id,
        "email": email,
        "name": name,
        "picture": picture,
    }


@api_router.get("/auth/me")
async def me(user=Depends(get_current_user)):
    return {
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user.get("picture", ""),
    }


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]

    if token:
        await db.user_sessions.delete_one({"session_token": token})

    response.delete_cookie(
        "session_token",
        path="/",
        samesite="none",
        secure=True,
    )
    return {"ok": True}


# ---------- Datasets and Options ----------
@api_router.get("/datasets")
async def list_datasets(user=Depends(get_current_user)):
    docs = await db.datasets.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return docs


@api_router.post("/datasets")
async def upsert_dataset(item: DatasetMaster, user=Depends(get_current_user)):
    data = item.model_dump()
    data["key"] = normalize_key(data["key"] or data["name"])
    if data["next_number"] < 1:
        data["next_number"] = 1
    await db.datasets.update_one({"key": data["key"]}, {"$set": data}, upsert=True)
    return {"ok": True}


@api_router.get("/options")
async def list_options(dataset: Optional[str] = None, user=Depends(get_current_user)):
    docs = await db.options.find({}, {"_id": 0}).to_list(10000)
    datasets = await db.datasets.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    grouped: Dict[str, Any] = {
        "test": [],
        "tests_by_dataset": {},
        "district": [],
        "sample_type": [],
        "sample_types_by_dataset": {},
        "datasets": datasets,
        "dataset": datasets,
    }

    for ds in datasets:
        key = ds.get("key")
        if key:
            if ds.get("tests"):
                grouped["tests_by_dataset"][key] = list(ds["tests"])
            if ds.get("sample_types"):
                grouped["sample_types_by_dataset"][key] = list(ds["sample_types"])

    dataset_key = normalize_key(dataset) if dataset else None
    for d in docs:
        typ = d.get("type")
        val = d.get("value")
        if typ == "test":
            ds = d.get("dataset") or "routine"
            grouped["tests_by_dataset"].setdefault(ds, []).append(val)
            if not dataset_key or ds == dataset_key:
                grouped["test"].append(val)
        elif typ in ("district", "sample_type"):
            grouped.setdefault(typ, []).append(val)

    for k in ("test", "district", "sample_type"):
        grouped[k] = sorted(set(grouped[k]))
    for ds in grouped["tests_by_dataset"]:
        grouped["tests_by_dataset"][ds] = sorted(set(grouped["tests_by_dataset"][ds]))
    return grouped


@api_router.post("/options")
async def add_option(item: OptionItem, user=Depends(get_current_user)):
    if item.type not in ("test", "district", "sample_type"):
        raise HTTPException(status_code=400, detail="Invalid type")
    val = item.value.strip()
    if not val:
        raise HTTPException(status_code=400, detail="Empty value")
    doc = {"type": item.type, "value": val}
    if item.type == "test" and item.dataset:
        doc["dataset"] = normalize_key(item.dataset)
        await get_dataset(doc["dataset"])
    existing = await db.options.find_one(doc)
    if not existing:
        await db.options.insert_one(doc)
    return {"ok": True}


@api_router.delete("/options")
async def delete_option(type: str, value: str, dataset: Optional[str] = None, user=Depends(get_current_user)):
    query = {"type": type, "value": value}
    if type == "test":
        if dataset:
            query["dataset"] = normalize_key(dataset)
        else:
            query["dataset"] = {"$exists": False}
    await db.options.delete_one(query)
    return {"ok": True}


@api_router.get("/masters")
async def list_masters(user=Depends(get_current_user)):
    docs = await db.options.find({}, {"_id": 0}).sort([("type", 1), ("value", 1)]).to_list(10000)
    result = {"test": [], "district": [], "sample_type": []}

    for doc in docs:
        option_type = doc.get("type")
        if option_type not in result:
            continue
        value = str(doc.get("value") or "").strip()
        if value and value not in result[option_type]:
            result[option_type].append(value)

    for key in result:
        result[key] = sorted(result[key])

    return result


# ---------- Records CRUD ----------
def _apply_filters(query: dict, dataset: Optional[str], test: Optional[str], district: Optional[str], sample_type: Optional[str], result_contains: Optional[str], search: Optional[str], date_from: Optional[str], date_to: Optional[str]):
    if dataset:
        query["dataset"] = normalize_key(dataset)
    if test:
        query["$or"] = query.get("$or", []) + [{"tests.test": test}, {"test": test}]
    if district:
        query["district"] = district
    if sample_type:
        query["sample_type"] = sample_type
    if result_contains:
        query["$or"] = query.get("$or", []) + [
            {"tests.result1": {"$regex": result_contains, "$options": "i"}},
            {"tests.result2": {"$regex": result_contains, "$options": "i"}},
            {"results.value": {"$regex": result_contains, "$options": "i"}},
            {"results.name": {"$regex": result_contains, "$options": "i"}},
        ]
    if search:
        query["$or"] = query.get("$or", []) + [
            {"name": {"$regex": search, "$options": "i"}},
            {"lab_number": {"$regex": search, "$options": "i"}},
            {"tests.test": {"$regex": search, "$options": "i"}},
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
    dataset_doc = await get_dataset(payload.dataset)
    tests = _tests_from_payload(payload)
    if not tests:
        raise HTTPException(status_code=400, detail="At least one test is required")

    seen = set()
    for t in tests:
        test_name = str(t.get("test") or "").strip()
        if not test_name:
            raise HTTPException(status_code=400, detail="Test name is required")
        if test_name.lower() in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate test: {test_name}")
        seen.add(test_name.lower())
        t["test"] = test_name

    lab_number = payload.lab_number or await generate_lab_number(dataset_doc["key"])
    legacy = _legacy_from_tests(tests)
    rec = LabRecord(
        dataset=dataset_doc["key"],
        lab_number=lab_number,
        date=payload.date,
        name=payload.name,
        age=payload.age,
        district=payload.district,
        sample_type=payload.sample_type,
        tests=tests,
        remarks=payload.remarks,
        created_by=user["user_id"],
        **legacy,
    )
    doc = rec.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = doc["updated_at"].isoformat()
    await db.records.insert_one(doc)
    return rec


@api_router.get("/records")
async def list_records(
    dataset: Optional[str] = None,
    test: Optional[str] = None,
    district: Optional[str] = None,
    sample_type: Optional[str] = None,
    result_contains: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    pending: Optional[bool] = None,
    page: int = 1,
    page_size: int = 25,
    user=Depends(get_current_user),
):
    query: dict = {}
    _apply_filters(query, dataset, test, district, sample_type, result_contains, search, date_from, date_to)
    if pending is True:
        # Match pending status on the selected test itself, not on another
        # test contained in the same laboratory record.
        if test:
            query.pop("$or", None)
            query["tests"] = {
                "$elemMatch": {
                    "test": test,
                    "result1": {"$in": [None, ""]},
                    "result2": {"$in": [None, ""]},
                }
            }
        else:
            query["$or"] = [
                {
                    "tests": {
                        "$elemMatch": {
                            "result1": {"$in": [None, ""]},
                            "result2": {"$in": [None, ""]},
                        }
                    }
                },
                {"tests": {"$size": 0}},
                {"tests": {"$exists": False}},
            ]
    elif pending is False:
        query["tests.0"] = {"$exists": True}

    total = await db.records.count_documents(query)
    skip = max(0, (page - 1) * page_size)
    cursor = db.records.find(query, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).skip(skip).limit(page_size)
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
    existing = await db.records.find_one({"id": rid}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Not found")

    raw = payload.model_dump(exclude_unset=True)
    update = {k: v for k, v in raw.items() if v is not None}

    if "dataset" in update:
        ds = await get_dataset(update["dataset"])
        update["dataset"] = ds["key"]
        # Do not regenerate lab_number on edit; lab number remains stable.

    if "tests" in raw or "test" in raw or "results" in raw:
        tests = _tests_from_payload(payload)
        if not tests:
            raise HTTPException(status_code=400, detail="At least one test is required")
        seen = set()
        for t in tests:
            test_name = str(t.get("test") or "").strip()
            if not test_name:
                raise HTTPException(status_code=400, detail="Test name is required")
            if test_name.lower() in seen:
                raise HTTPException(status_code=400, detail=f"Duplicate test: {test_name}")
            seen.add(test_name.lower())
            t["test"] = test_name
        update["tests"] = tests
        update.update(_legacy_from_tests(tests))

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = now_iso()

    await db.records.update_one({"id": rid}, {"$set": update})
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
    if not payload.test.strip():
        raise HTTPException(status_code=400, detail="Test is required")

    matched = 0
    modified = 0

    for rid in payload.ids:
        record = await db.records.find_one({"id": rid}, {"_id": 0})
        if not record:
            continue

        tests = record.get("tests") or []
        changed = False

        for item in tests:
            if str(item.get("test") or "").strip() == payload.test.strip():
                matched += 1
                item["result1"] = payload.result1 or ""
                item["result2"] = payload.result2 or ""
                item["result_date"] = payload.result_date or item.get("result_date")
                changed = True
                break

        if not changed:
            continue

        legacy = _legacy_from_tests(tests)
        result = await db.records.update_one(
            {"id": rid},
            {"$set": {
                "tests": tests,
                "test": legacy["test"],
                "results": legacy["results"],
                "result_date": legacy["result_date"],
                "updated_at": now_iso(),
            }},
        )
        modified += result.modified_count

    return {"matched": matched, "modified": modified}


# ---------- Import ----------
def _get_cell(row, *names):
    for name in names:
        key = str(name).lower().replace(" ", "_")
        if key in row and pd.notna(row.get(key)):
            val = row.get(key)
            if str(val).strip() != "":
                return val
    return None


@api_router.post("/records/import")
async def import_records(file: UploadFile = File(...), user=Depends(get_current_user)):
    content = await file.read()
    try:
        if file.filename.lower().endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Parse error: {e}")

    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    required_any = {
        "dataset": ["dataset", "data_set"],
        "date": ["date", "sample_date"],
        "name": ["name", "patient_name", "patient"],
        "district": ["district"],
        "sample_type": ["sample_type", "sample"],
        "test": ["test", "test_name"],
    }
    missing = []
    for label, choices in required_any.items():
        if not any(c in df.columns for c in choices):
            missing.append(label)
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {missing}")

    inserted = 0
    errors = []
    groups: List[Dict[str, Any]] = []
    current_group = None
    current_key = None

    # Group only consecutive rows, preserving Excel sequence exactly.
    for idx, row in df.iterrows():
        try:
            row_dict = row.to_dict()
            dataset_raw = str(_get_cell(row_dict, "dataset", "data_set") or "").strip()
            date = normalize_date(_get_cell(row_dict, "date", "sample_date"))
            name = str(_get_cell(row_dict, "name", "patient_name", "patient") or "").strip()
            age_val = _get_cell(row_dict, "age")
            district = str(_get_cell(row_dict, "district") or "").strip()
            sample_type = str(_get_cell(row_dict, "sample_type", "sample") or "").strip()
            test_name = str(_get_cell(row_dict, "test", "test_name") or "").strip()

            if not dataset_raw or not date or not name or not district or not sample_type or not test_name:
                raise ValueError("Dataset, Date, Name, District, Sample Type, and Test are required")

            dataset_doc = await get_dataset(dataset_raw)
            try:
                age = int(age_val) if age_val is not None and str(age_val).strip() != "" else None
            except Exception:
                age = None

            result1 = _get_cell(row_dict, "result_1", "result1", "result", "result_field_1")
            result2 = _get_cell(row_dict, "result_2", "result2", "result_field_2")
            result_date = normalize_date(_get_cell(row_dict, "result_date")) or None
            remarks = _get_cell(row_dict, "remarks")

            key = (dataset_doc["key"], date, name, age, district, sample_type)
            test_item = {
                "test": test_name,
                "result1": str(result1).strip() if result1 is not None else None,
                "result2": str(result2).strip() if result2 is not None else None,
                "result_date": result_date,
            }

            if current_group is None or key != current_key:
                current_group = {
                    "row": int(idx) + 2,
                    "dataset": dataset_doc["key"],
                    "date": date,
                    "name": name,
                    "age": age,
                    "district": district,
                    "sample_type": sample_type,
                    "tests": [],
                    "remarks": str(remarks).strip() if remarks is not None else None,
                }
                groups.append(current_group)
                current_key = key

            if test_name.lower() in {t["test"].lower() for t in current_group["tests"]}:
                raise ValueError(f"Duplicate test in same consecutive group: {test_name}")
            current_group["tests"].append(test_item)

        except Exception as e:
            errors.append({"row": int(idx) + 2, "error": str(e)})

    for group in groups:
        try:
            lab_number = await generate_lab_number(group["dataset"])
            legacy = _legacy_from_tests(group["tests"])
            rec = {
                "id": str(uuid.uuid4()),
                "dataset": group["dataset"],
                "lab_number": lab_number,
                "date": group["date"],
                "name": group["name"],
                "age": group["age"],
                "district": group["district"],
                "sample_type": group["sample_type"],
                "tests": group["tests"],
                "remarks": group.get("remarks"),
                "created_by": user["user_id"],
                "created_at": now_iso(),
                "updated_at": now_iso(),
                **legacy,
            }
            await db.records.insert_one(rec)
            inserted += 1
        except Exception as e:
            errors.append({"row": group.get("row"), "error": str(e)})

    return {"inserted": inserted, "errors": errors[:50]}


# ---------- Export ----------
def _flatten_records_for_export(records: List[dict]) -> List[dict]:
    rows = []
    for r in records:
        r = _serialize_record(r)
        tests = r.get("tests") or []
        if not tests:
            tests = [{"test": "", "result1": "", "result2": "", "result_date": r.get("result_date") or ""}]
        for i, t in enumerate(tests):
            first = i == 0
            rows.append({
                "Lab Number": r.get("lab_number", "") if first else "",
                "Date": r.get("date", "") if first else "",
                "Name": r.get("name", "") if first else "",
                "Age": r.get("age", "") if first else "",
                "District": r.get("district", "") if first else "",
                "Sample Type": r.get("sample_type", "") if first else "",
                "Test": t.get("test", ""),
                "Result 1": t.get("result1", ""),
                "Result 2": t.get("result2", ""),
                "Result Date": t.get("result_date", ""),
                "Remarks": r.get("remarks", "") if first else "",
            })
    return rows


@api_router.get("/export")
async def export_records(
    format: str = "csv",
    dataset: Optional[str] = None,
    test: Optional[str] = None,
    district: Optional[str] = None,
    sample_type: Optional[str] = None,
    result_contains: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user=Depends(get_current_user),
):
    query: dict = {}
    _apply_filters(query, dataset, test, district, sample_type, result_contains, search, date_from, date_to)
    cursor = db.records.find(query, {"_id": 0}).sort([("date", -1), ("created_at", -1)])
    items = await cursor.to_list(100000)
    if test:
        filtered_items = []
        for item in items:
            serialized = _serialize_record(item)
            matched_tests = [
                t for t in (serialized.get("tests") or [])
                if str(t.get("test") or "") == test
            ]
            if matched_tests:
                serialized["tests"] = matched_tests
                filtered_items.append(serialized)
        items = filtered_items
    rows = _flatten_records_for_export(items)
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

    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=lab_records_{datetime.now().strftime('%Y%m%d_%H%M')}.csv"},
    )


@api_router.get("/import-template")
async def import_template(format: str = "xlsx", user=Depends(get_current_user)):
    rows = [{
        "Dataset": "Routine",
        "Date": datetime.now().strftime("%Y-%m-%d"),
        "Patient Name": "Sample Patient",
        "Age": 30,
        "District": "Thiruvananthapuram",
        "Sample Type": "Serum",
        "Test Name": "Dengue NS1",
        "Result 1": "Positive",
        "Result 2": "",
        "Result Date": datetime.now().strftime("%Y-%m-%d"),
        "Remarks": "",
    }]
    df = pd.DataFrame(rows)
    if format == "xlsx":
        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="ImportTemplate")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=sphcl_import_template.xlsx"},
        )
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=sphcl_import_template.csv"})


# ---------- Stats ----------
@api_router.get("/stats")
async def stats(user=Depends(get_current_user)):
    total = await db.records.count_documents({})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_count = await db.records.count_documents({"date": today})
    pending = await db.records.count_documents({
        "$or": [
            {"tests": {"$size": 0}},
            {"tests": {"$exists": False}},
            {"tests.result1": {"$in": [None, ""]}},
        ]
    })
    districts = len(await db.records.distinct("district"))
    tests_agg = await db.records.aggregate([
        {"$unwind": {"path": "$tests", "preserveNullAndEmptyArrays": True}},
        {"$group": {"_id": "$tests.test", "count": {"$sum": 1}}},
        {"$match": {"_id": {"$ne": None}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]).to_list(5)
    dataset_agg = await db.records.aggregate([
        {"$group": {"_id": "$dataset", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(50)
    return {
        "total": total,
        "today": today_count,
        "pending": pending,
        "districts": districts,
        "top_tests": [{"test": t["_id"], "count": t["count"]} for t in tests_agg],
        "datasets": [{"dataset": d["_id"], "count": d["count"]} for d in dataset_agg],
    }


# ---------- Root health ----------
@api_router.get("/")
async def root():
    return {"service": "SPHCL Molecular Diagnosis - Lab Data Management"}


app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
