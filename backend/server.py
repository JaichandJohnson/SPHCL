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
import re
import httpx
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import pandas as pd
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone, timedelta
from backup_service import register_backup

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ---------- Constants ----------
KERALA_DISTRICTS = [
    "Trivandrum", "Thiruvananthapuram", "Kollam", "Pathanamthitta", "Alappuzha",
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
    {"key": "typhoid_surveillance", "name": "Typhoid Surveillance", "prefix": "TY", "next_number": 1, "active": True},
]

DEFAULT_TESTS_BY_DATASET = {
    "routine": ["RT-PCR SARS-CoV-2", "Dengue NS1", "H1N1 RT-PCR", "HIV Viral Load", "HCV RNA", "HBV DNA", "Tuberculosis PCR"],
    "mr_surveillance": ["Measles IgM", "Rubella IgM", "Measles RT-PCR", "Rubella RT-PCR"],
    "diphtheria": ["Diphtheria Culture", "Diphtheria PCR"],
    "pertussis": ["Pertussis PCR", "Pertussis Culture"],
    "rabies": ["Rabies DFA", "Rabies PCR", "Rabies Antibody"],
    "fla": ["FLA Microscopy", "FLA PCR", "Acanthamoeba PCR", "Naegleria PCR"],
    "special_serology": ["VPD Serology", "Varicella IgM", "Mumps IgM", "JE IgM"],
    "typhoid_surveillance": ["Salmonella Typhi Culture", "Typhoid PCR", "Widal Test"],
}

VALID_RESULT_VALUES = {"", "Positive", "Negative", "Indeterminate", "Pending"}

# ---------- Models ----------
class ResultItem(BaseModel):
    """Backward-compatible old result item."""
    name: str
    value: Optional[str] = None


class TestSourceItem(BaseModel):
    type: str  # manual | mapping | panel
    id: Optional[str] = None
    name: Optional[str] = None


class AssignedPanelItem(BaseModel):
    panel_id: str
    panel_name: str
    tests: List[str] = Field(default_factory=list)


class TestResultItem(BaseModel):
    id: str = Field(default_factory=lambda: f"test_{uuid.uuid4().hex[:12]}")
    test: str
    result1: Optional[str] = None
    result2: Optional[str] = None
    result_date: Optional[str] = None
    remarks: Optional[str] = None
    sources: List[TestSourceItem] = Field(default_factory=list)


class SampleItem(BaseModel):
    id: str = Field(default_factory=lambda: f"sample_{uuid.uuid4().hex[:12]}")
    dataset: Optional[str] = None
    lab_number: Optional[str] = None
    epid_number: Optional[str] = None
    sample_type: str
    tests: List[TestResultItem] = Field(default_factory=list)
    assigned_panels: List[AssignedPanelItem] = Field(default_factory=list)
    remarks: Optional[str] = None


class SampleTestMapping(BaseModel):
    sample_type: str
    tests: List[str] = Field(default_factory=list)
    auto_assign: bool = False
    panels: List[str] = Field(default_factory=list)
    auto_assign_panels: bool = False


class DatasetMaster(BaseModel):
    model_config = ConfigDict(extra="ignore")
    key: str
    name: str
    prefix: str
    next_number: int = 1
    active: bool = True
    tests: List[str] = Field(default_factory=list)
    sample_types: List[str] = Field(default_factory=list)
    sample_mappings: List[SampleTestMapping] = Field(default_factory=list)


class PanelMaster(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: Optional[str] = None
    name: str
    dataset: str
    tests: List[str] = Field(default_factory=list)
    active: bool = True


class LabRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    patient_id: str = ""
    dataset: str = "routine"
    lab_number: str = ""
    date: str
    name: str
    age: Optional[int] = None
    sex: Optional[str] = None
    district: str = "Trivandrum"
    requesting_institution: Optional[str] = None
    epid_number: Optional[str] = None
    mr_patient_number: Optional[int] = None
    mr_sequence_year: Optional[int] = None
    rabies_patient_number: Optional[int] = None
    rabies_sequence_year: Optional[int] = None
    samples: List[SampleItem] = Field(default_factory=list)
    remarks: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Legacy fields retained while older frontend pages are being migrated.
    sample_type: str = ""
    tests: List[TestResultItem] = Field(default_factory=list)
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
    sex: Optional[str] = None
    district: str = "Trivandrum"
    requesting_institution: Optional[str] = None
    epid_number: Optional[str] = None
    mr_patient_number: Optional[int] = None
    mr_sequence_year: Optional[int] = None
    rabies_patient_number: Optional[int] = None
    rabies_sequence_year: Optional[int] = None
    samples: List[SampleItem] = Field(default_factory=list)
    auto_assign_tests: bool = False
    remarks: Optional[str] = None

    # Backward-compatible old fields.
    sample_type: Optional[str] = None
    tests: List[TestResultItem] = Field(default_factory=list)
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
    sex: Optional[str] = None
    district: Optional[str] = None
    requesting_institution: Optional[str] = None
    epid_number: Optional[str] = None
    samples: Optional[List[SampleItem]] = None
    auto_assign_tests: Optional[bool] = None
    remarks: Optional[str] = None

    # Backward-compatible old fields.
    sample_type: Optional[str] = None
    tests: Optional[List[TestResultItem]] = None
    test: Optional[str] = None
    results: Optional[List[ResultItem]] = None
    result_date: Optional[str] = None


class BulkResultPayload(BaseModel):
    ids: List[str]
    test: str
    result1: Optional[str] = None
    result2: Optional[str] = None
    result_date: Optional[str] = None
    remarks: Optional[str] = None
    sample_id: Optional[str] = None


class OptionItem(BaseModel):
    type: str  # 'test' | 'district' | 'sample_type'
    value: str
    dataset: Optional[str] = None


class MasterUnlockPayload(BaseModel):
    password: str


class RenameOptionPayload(BaseModel):
    type: str
    old_value: str
    new_value: str


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


def _test_dict(item: Any) -> Dict[str, Any]:
    data = item if isinstance(item, dict) else item.model_dump()
    return {
        "id": str(data.get("id") or f"test_{uuid.uuid4().hex[:12]}"),
        "test": str(data.get("test") or "").strip(),
        "result1": data.get("result1"),
        "result2": data.get("result2"),
        "result_date": data.get("result_date"),
        "remarks": data.get("remarks"),
        "sources": [
            source if isinstance(source, dict) else source.model_dump()
            for source in (data.get("sources") or [])
        ],
    }


def _validate_tests(tests: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    cleaned = []
    for raw in tests:
        item = _test_dict(raw)
        name = item["test"]
        if not name:
            raise HTTPException(status_code=400, detail="Test name is required")
        key = name.lower()
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate test in the same sample: {name}")
        seen.add(key)
        cleaned.append(item)
    return cleaned


def _tests_from_payload(payload: LabRecordCreate | LabRecordUpdate) -> List[Dict[str, Any]]:
    data = payload.model_dump(exclude_unset=True)
    tests = data.get("tests")
    if tests:
        return [_test_dict(t) for t in tests]
    legacy_test = data.get("test")
    legacy_results = data.get("results") or []
    result_date = data.get("result_date")
    if legacy_test:
        first = legacy_results[0] if legacy_results else {}
        if not isinstance(first, dict):
            first = first.model_dump()
        return [_test_dict({
            "test": legacy_test,
            "result1": first.get("name"),
            "result2": first.get("value"),
            "result_date": result_date,
        })]
    return []


def _dataset_sample_mapping(dataset_doc: Optional[dict], sample_type: str) -> Optional[dict]:
    if not dataset_doc:
        return None
    wanted = str(sample_type or "").strip().lower()
    for mapping in dataset_doc.get("sample_mappings") or []:
        if str(mapping.get("sample_type") or "").strip().lower() == wanted:
            return mapping
    return None


async def _samples_from_payload(
    payload: LabRecordCreate | LabRecordUpdate,
    dataset_doc: Optional[dict] = None,
) -> List[Dict[str, Any]]:
    data = payload.model_dump(exclude_unset=True)
    raw_samples = data.get("samples") or []
    samples = []

    fallback_dataset_key = normalize_key(
        (dataset_doc or {}).get("key")
        or data.get("dataset")
        or "routine"
    )

    for raw in raw_samples:
        sample = raw if isinstance(raw, dict) else raw.model_dump()

        sample_dataset_key = normalize_key(
            sample.get("dataset")
            or fallback_dataset_key
        )
        sample_dataset_doc = await get_dataset(sample_dataset_key)

        sample_type = str(sample.get("sample_type") or "").strip()
        if not sample_type:
            raise HTTPException(
                status_code=400,
                detail="Sample type is required",
            )

        mapping = _dataset_sample_mapping(
            sample_dataset_doc,
            sample_type,
        )
        configured_mappings = (
            sample_dataset_doc.get("sample_mappings") or []
        )

        if configured_mappings and not mapping:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Sample type '{sample_type}' is not configured "
                    f"for dataset '{sample_dataset_doc.get('name', sample_dataset_key)}'"
                ),
            )

        tests = [
            _test_dict(test)
            for test in (sample.get("tests") or [])
        ]

        if not tests and mapping and mapping.get("auto_assign"):
            tests = [
                _test_dict({"test": name})
                for name in (mapping.get("tests") or [])
            ]

        if not tests:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"At least one test is required for sample: "
                    f"{sample_type}"
                ),
            )

        tests = _validate_tests(tests)

        if mapping:
            allowed = {
                str(name).strip().lower()
                for name in (mapping.get("tests") or [])
                if str(name).strip()
            }
            invalid = [
                item["test"]
                for item in tests
                if item["test"].lower() not in allowed
            ]
            if invalid:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Tests not allowed for {sample_type}: "
                        + ", ".join(invalid)
                    ),
                )

        samples.append(
            {
                "id": str(
                    sample.get("id")
                    or f"sample_{uuid.uuid4().hex[:12]}"
                ),
                "dataset": sample_dataset_doc["key"],
                "lab_number": (
                    str(sample.get("lab_number") or "").strip()
                    or None
                ),
                "epid_number": (
                    str(sample.get("epid_number") or "").strip()
                    or None
                ),
                "sample_type": sample_type,
                "tests": tests,
                "assigned_panels": [
                    panel if isinstance(panel, dict) else panel.model_dump()
                    for panel in (sample.get("assigned_panels") or [])
                ],
                "remarks": sample.get("remarks"),
            }
        )

    if samples:
        return samples

    # Backward-compatible single-sample payload.
    sample_type = str(data.get("sample_type") or "").strip()
    tests = _tests_from_payload(payload)

    if sample_type:
        fallback_dataset_doc = await get_dataset(fallback_dataset_key)
        mapping = _dataset_sample_mapping(
            fallback_dataset_doc,
            sample_type,
        )

        if not tests and mapping and mapping.get("auto_assign"):
            tests = [
                _test_dict({"test": name})
                for name in (mapping.get("tests") or [])
            ]

        if tests:
            tests = _validate_tests(tests)

            if mapping:
                allowed = {
                    str(name).strip().lower()
                    for name in (mapping.get("tests") or [])
                    if str(name).strip()
                }
                invalid = [
                    item["test"]
                    for item in tests
                    if item["test"].lower() not in allowed
                ]
                if invalid:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f"Tests not allowed for {sample_type}: "
                            + ", ".join(invalid)
                        ),
                    )

            return [
                {
                    "id": f"sample_{uuid.uuid4().hex[:12]}",
                    "dataset": fallback_dataset_doc["key"],
                    "lab_number": (
                        str(data.get("lab_number") or "").strip()
                        or None
                    ),
                    "sample_type": sample_type,
                    "tests": tests,
                    "assigned_panels": [],
                    "remarks": None,
                }
            ]

    return []


def _all_tests(record: dict) -> List[Dict[str, Any]]:
    samples = record.get("samples") or []
    if samples:
        return [test for sample in samples for test in (sample.get("tests") or [])]
    return record.get("tests") or []


def _legacy_from_samples(samples: List[Dict[str, Any]]) -> Dict[str, Any]:
    first_sample = samples[0] if samples else {}
    tests = first_sample.get("tests") or []
    legacy = _legacy_from_tests(tests)
    return {
        "sample_type": first_sample.get("sample_type", ""),
        "tests": tests,
        **legacy,
    }


def _legacy_from_tests(tests: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not tests:
        return {"test": "", "results": [], "result_date": None}
    first = tests[0]
    return {
        "test": first.get("test", ""),
        "results": [{"name": first.get("result1") or "", "value": first.get("result2") or ""}],
        "result_date": first.get("result_date"),
    }


def _serialize_record(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    for key in ("created_at", "updated_at"):
        value = doc.get(key)
        if isinstance(value, datetime):
            doc[key] = value.isoformat()

    if not doc.get("tests"):
        legacy_test = doc.get("test")
        legacy_results = doc.get("results") or []
        if legacy_test:
            doc["tests"] = [_test_dict({
                "test": legacy_test,
                "result1": legacy_results[0].get("name") if legacy_results else None,
                "result2": legacy_results[0].get("value") if legacy_results else None,
                "result_date": doc.get("result_date"),
            })]

    if not doc.get("samples") and (doc.get("sample_type") or doc.get("tests")):
        doc["samples"] = [{
            "id": f"sample_{uuid.uuid4().hex[:12]}",
            "dataset": doc.get("dataset") or "routine",
            "lab_number": doc.get("lab_number") or "",
            "epid_number": doc.get("epid_number"),
            "sample_type": doc.get("sample_type") or "",
            "tests": [_test_dict(t) for t in (doc.get("tests") or [])],
            "assigned_panels": [],
            "remarks": None,
        }]
    else:
        for sample in doc.get("samples") or []:
            sample.setdefault("id", f"sample_{uuid.uuid4().hex[:12]}")
            sample.setdefault(
                "dataset",
                doc.get("dataset") or "routine",
            )
            sample.setdefault("lab_number", "")
            sample.setdefault("epid_number", None)
            sample.setdefault("assigned_panels", [])
            sample["tests"] = [
                _test_dict(test)
                for test in (sample.get("tests") or [])
            ]

    if doc.get("samples"):
        doc.update(_legacy_from_samples(doc["samples"]))
    return doc


async def generate_patient_id() -> str:
    year = datetime.now(timezone.utc).year
    key = f"patient_{year}"
    counter = await db.counters.find_one_and_update(
        {"key": key},
        {"$inc": {"value": 1}, "$setOnInsert": {"key": key}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    return f"PT-{year}-{int(counter.get('value', 1)):06d}"


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



def mr_sample_prefix(sample_type: str) -> str:
    normalized = re.sub(r"\s+", " ", str(sample_type or "").strip().lower())
    if normalized == "serum":
        return "WM S"
    if normalized == "urine":
        return "WM U"
    if normalized in {
        "throat swab",
        "nasopharyngeal swab",
        "naso pharyngeal swab",
        "oropharyngeal swab",
    }:
        return "WM T"
    raise HTTPException(
        status_code=400,
        detail=(
            "MR Surveillance lab numbering supports Serum, Urine, "
            "Throat Swab and Nasopharyngeal Swab"
        ),
    )


async def generate_mr_patient_number() -> tuple[int, int]:
    year = datetime.now(timezone.utc).year
    counter = await db.counters.find_one_and_update(
        {"key": f"mr_patient_{year}"},
        {
            "$inc": {"value": 1},
            "$setOnInsert": {
                "key": f"mr_patient_{year}",
                "year": year,
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    return int(counter.get("value", 1)), year


def assign_mr_lab_numbers(
    samples: List[Dict[str, Any]],
    sequence: int,
) -> None:
    for sample in samples:
        if sample.get("dataset") == "mr_surveillance":
            sample["lab_number"] = (
                f"{mr_sample_prefix(sample.get('sample_type'))} {sequence}"
            )



def rabies_sample_suffix(sample_type: str) -> str:
    normalized = re.sub(r"\s+", " ", str(sample_type or "").strip().lower())
    aliases = {
        "csf": "C",
        "brain": "B",
        "nuchal biopsy": "T",
        "saliva": "S",
        "conjunctival swab": "CS",
        "corneal swab": "CS",
        "conjunctival/corneal swab": "CS",
        "plasma": "P",
        "serum": "SR",
    }
    if normalized not in aliases:
        raise HTTPException(
            status_code=400,
            detail=(
                "Rabies numbering supports CSF, Brain, Nuchal biopsy, Saliva, "
                "Conjunctival/Corneal swab, Plasma and Serum"
            ),
        )
    return aliases[normalized]


async def generate_rabies_patient_number() -> tuple[int, int]:
    year = datetime.now(timezone.utc).year
    counter = await db.counters.find_one_and_update(
        {"key": f"rabies_patient_{year}"},
        {"$inc": {"value": 1}, "$setOnInsert": {"key": f"rabies_patient_{year}", "year": year}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    return int(counter.get("value", 1)), year


def assign_rabies_lab_numbers(samples: List[Dict[str, Any]], sequence: int, year: int) -> None:
    base_number = f"R {sequence:03d}/{str(year)[-2:]}"
    for sample in samples:
        if sample.get("dataset") == "rabies":
            sample["lab_number"] = (
                f"{base_number} {rabies_sample_suffix(sample.get('sample_type'))}"
            )


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


register_backup(app, api_router, db, get_current_user)

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

    # Seed default tests only for a completely new installation. Once users manage
    # Test Master, deleted tests must not be recreated during every deployment.
    if await db.options.count_documents({"type": "test"}) == 0:
        default_test_docs = [
            {"type": "test", "dataset": dataset, "value": test}
            for dataset, tests in DEFAULT_TESTS_BY_DATASET.items()
            for test in tests
        ]
        if default_test_docs:
            await db.options.insert_many(default_test_docs)

    # Helpful indexes.
    await db.records.create_index("id", unique=True)
    await db.records.create_index("patient_id")
    await db.records.create_index("lab_number")
    await db.records.create_index("date")
    await db.records.create_index("dataset")
    await db.records.create_index("tests.test")
    await db.master_sessions.create_index("expires_at")
    await db.records.create_index("samples.dataset")
    await db.records.create_index("samples.lab_number")
    await db.records.create_index("samples.epid_number")
    await db.records.create_index("samples.tests.test")
    await db.records.create_index("samples.sample_type")
    await db.datasets.create_index("key", unique=True)


# ---------- Auth Routes ----------
class GoogleLoginPayload(BaseModel):
    credential: str


@api_router.post("/auth/google")
async def google_login(payload: GoogleLoginPayload, response: Response):
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        raise HTTPException(
            status_code=500,
            detail="Google authentication is not configured",
        )

    try:
        token_data = id_token.verify_oauth2_token(
            payload.credential,
            google_requests.Request(),
            client_id,
        )
    except ValueError:
        raise HTTPException(
            status_code=401,
            detail="Invalid Google credential",
        )

    email = str(token_data.get("email") or "").strip().lower()
    name = str(token_data.get("name") or email).strip()
    picture = str(token_data.get("picture") or "")
    email_verified = token_data.get("email_verified", False)

    if not email or not email_verified:
        raise HTTPException(
            status_code=401,
            detail="Google email is not verified",
        )

    allowed_emails = [
        item.strip().lower()
        for item in os.environ.get("ALLOWED_EMAILS", "").split(",")
        if item.strip()
    ]

    if allowed_emails and email not in allowed_emails:
        raise HTTPException(
            status_code=403,
            detail=(
                "Access denied. Your Google account is not authorized "
                "to use the MDS Laboratory Information Management System."
            ),
        )

    existing = await db.users.find_one(
        {"email": email},
        {"_id": 0},
    )
    now = now_iso()

    if existing:
        user_id = existing["user_id"]

        await db.users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "name": name,
                    "picture": picture,
                    "email_verified": True,
                    "last_login_at": now,
                }
            },
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"

        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "email_verified": True,
                "created_at": now,
                "last_login_at": now,
            }
        )

    session_token = uuid.uuid4().hex + uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)

    await db.user_sessions.delete_many(
        {"user_id": user_id}
    )

    await db.user_sessions.insert_one(
        {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at.isoformat(),
            "created_at": now,
        }
    )

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
        "session_token": session_token,
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



# ---------- Master Data Security ----------
MASTER_UNLOCK_MINUTES = int(os.environ.get("MASTER_UNLOCK_MINUTES", "15"))


def _request_session_token(request: Request) -> Optional[str]:
    token = request.cookies.get("session_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    return token


async def require_master_access(
    request: Request,
    user=Depends(get_current_user),
):
    session_token = _request_session_token(request)
    master_token = request.cookies.get("master_access_token")

    if not session_token or not master_token:
        raise HTTPException(status_code=403, detail="Master Data is locked")

    access = await db.master_sessions.find_one(
        {
            "session_token": session_token,
            "master_token": master_token,
        },
        {"_id": 0},
    )

    if not access:
        raise HTTPException(status_code=403, detail="Master Data is locked")

    expires_at = access.get("expires_at")
    if isinstance(expires_at, str):
        try:
            expires_at = datetime.fromisoformat(expires_at)
        except ValueError:
            expires_at = None

    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if not expires_at or expires_at <= datetime.now(timezone.utc):
        await db.master_sessions.delete_one(
            {
                "session_token": session_token,
                "master_token": master_token,
            }
        )
        raise HTTPException(status_code=403, detail="Master Data access expired")

    return user


@api_router.get("/master/status")
async def master_status(
    request: Request,
    user=Depends(get_current_user),
):
    try:
        await require_master_access(request, user)
        return {"unlocked": True}
    except HTTPException:
        return {"unlocked": False}


@api_router.post("/master/unlock")
async def unlock_master_data(
    payload: MasterUnlockPayload,
    request: Request,
    response: Response,
    user=Depends(get_current_user),
):
    configured_password = os.environ.get("MASTER_ADMIN_PASSWORD", "")
    if not configured_password:
        raise HTTPException(
            status_code=503,
            detail="MASTER_ADMIN_PASSWORD is not configured in Render",
        )

    if payload.password != configured_password:
        raise HTTPException(status_code=403, detail="Incorrect admin password")

    session_token = _request_session_token(request)
    master_token = uuid.uuid4().hex + uuid.uuid4().hex
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=MASTER_UNLOCK_MINUTES
    )

    await db.master_sessions.delete_many({"session_token": session_token})
    await db.master_sessions.insert_one(
        {
            "session_token": session_token,
            "master_token": master_token,
            "expires_at": expires_at.isoformat(),
            "created_at": now_iso(),
        }
    )

    response.set_cookie(
        key="master_access_token",
        value=master_token,
        max_age=MASTER_UNLOCK_MINUTES * 60,
        httponly=True,
        secure=True,
        samesite="none",
        path="/",
    )

    return {"ok": True, "unlocked_until": expires_at.isoformat()}


@api_router.post("/master/lock")
async def lock_master_data(
    request: Request,
    response: Response,
    user=Depends(get_current_user),
):
    session_token = _request_session_token(request)
    if session_token:
        await db.master_sessions.delete_many({"session_token": session_token})

    response.delete_cookie(
        "master_access_token",
        path="/",
        secure=True,
        samesite="none",
    )
    return {"ok": True}


# ---------- Datasets and Options ----------
@api_router.get("/datasets")
async def list_datasets(user=Depends(require_master_access)):
    docs = await db.datasets.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return docs


@api_router.post("/datasets")
async def upsert_dataset(item: DatasetMaster, user=Depends(require_master_access)):
    data = item.model_dump()
    data["key"] = normalize_key(data["key"] or data["name"])
    if data["next_number"] < 1:
        data["next_number"] = 1

    mappings = []
    seen_samples = set()
    for raw in data.get("sample_mappings") or []:
        sample_type = str(raw.get("sample_type") or "").strip()
        if not sample_type:
            continue
        sample_key = sample_type.lower()
        if sample_key in seen_samples:
            raise HTTPException(
                status_code=400,
                detail=f"Duplicate sample mapping: {sample_type}",
            )
        seen_samples.add(sample_key)
        tests = list(
            dict.fromkeys(
                str(test).strip()
                for test in (raw.get("tests") or [])
                if str(test).strip()
            )
        )
        panel_ids = list(
            dict.fromkeys(
                str(panel_id).strip()
                for panel_id in (raw.get("panels") or [])
                if str(panel_id).strip()
            )
        )
        mappings.append(
            {
                "sample_type": sample_type,
                "tests": tests,
                "auto_assign": bool(raw.get("auto_assign")),
                "panels": panel_ids,
                "auto_assign_panels": bool(
                    raw.get("auto_assign_panels")
                ),
            }
        )

    data["sample_mappings"] = mappings
    if mappings:
        # Keep legacy arrays synchronized for older screens and reports.
        data["sample_types"] = [mapping["sample_type"] for mapping in mappings]
        data["tests"] = list(
            dict.fromkeys(
                test for mapping in mappings for test in mapping["tests"]
            )
        )
    else:
        data["sample_types"] = list(
            dict.fromkeys(
                str(value).strip()
                for value in (data.get("sample_types") or [])
                if str(value).strip()
            )
        )
        data["tests"] = list(
            dict.fromkeys(
                str(value).strip()
                for value in (data.get("tests") or [])
                if str(value).strip()
            )
        )

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
        "sample_mappings_by_dataset": {},
        "datasets": datasets,
        "dataset": datasets,
        "panels": [],
        "panels_by_dataset": {},
        "report_remark": [],
    }

    for ds in datasets:
        key = ds.get("key")
        if key:
            if ds.get("tests"):
                grouped["tests_by_dataset"][key] = list(ds["tests"])
            mappings = ds.get("sample_mappings") or []
            if mappings:
                grouped["sample_mappings_by_dataset"][key] = mappings
                grouped["sample_types_by_dataset"][key] = [
                    mapping.get("sample_type")
                    for mapping in mappings
                    if mapping.get("sample_type")
                ]
                grouped["tests_by_dataset"][key] = list(
                    dict.fromkeys(
                        test
                        for mapping in mappings
                        for test in (mapping.get("tests") or [])
                    )
                )
            elif ds.get("sample_types"):
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

    panels = await db.panels.find({"active": True}, {"_id": 0}).sort("name", 1).to_list(1000)
    grouped["panels"] = panels
    grouped["panels_by_dataset"] = {}
    for panel in panels:
        grouped["panels_by_dataset"].setdefault(panel.get("dataset"), []).append(panel)

    for k in ("test", "district", "sample_type"):
        grouped[k] = sorted(set(grouped[k]))
    for ds in grouped["tests_by_dataset"]:
        grouped["tests_by_dataset"][ds] = sorted(set(grouped["tests_by_dataset"][ds]))
    panels = await db.panels.find(
        {"active": {"$ne": False}},
        {"_id": 0},
    ).sort("name", 1).to_list(1000)
    grouped["panels"] = panels
    for panel in panels:
        grouped["panels_by_dataset"].setdefault(
            panel.get("dataset"), []
        ).append(panel)

    return grouped


@api_router.post("/options")
async def add_option(item: OptionItem, user=Depends(require_master_access)):
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


@api_router.put("/options/rename")
async def rename_option(
    payload: RenameOptionPayload,
    user=Depends(require_master_access),
):
    if payload.type != "test":
        raise HTTPException(
            status_code=400,
            detail="Only Test Master names can be edited",
        )

    old_value = str(payload.old_value or "").strip()
    new_value = str(payload.new_value or "").strip()

    if not old_value or not new_value:
        raise HTTPException(
            status_code=400,
            detail="Old and new test names are required",
        )

    if old_value.lower() == new_value.lower():
        return {"ok": True}

    duplicate = await db.options.find_one(
        {
            "type": "test",
            "value": {
                "$regex": f"^{re.escape(new_value)}$",
                "$options": "i",
            },
        }
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="A test with this name already exists",
        )

    await db.options.update_many(
        {"type": "test", "value": old_value},
        {"$set": {"value": new_value}},
    )

    datasets = await db.datasets.find(
        {
            "$or": [
                {"tests": old_value},
                {"sample_mappings.tests": old_value},
            ]
        }
    ).to_list(1000)

    for dataset in datasets:
        updated_tests = [
            new_value if value == old_value else value
            for value in (dataset.get("tests") or [])
        ]
        updated_mappings = []
        for mapping in dataset.get("sample_mappings") or []:
            updated_mappings.append(
                {
                    **mapping,
                    "tests": [
                        new_value if value == old_value else value
                        for value in (mapping.get("tests") or [])
                    ],
                }
            )

        await db.datasets.update_one(
            {"_id": dataset["_id"]},
            {
                "$set": {
                    "tests": list(dict.fromkeys(updated_tests)),
                    "sample_mappings": updated_mappings,
                }
            },
        )

    await db.panels.update_many(
        {"tests": old_value},
        {"$set": {"tests.$[test]": new_value}},
        array_filters=[{"test": old_value}],
    )

    # Existing laboratory records retain the historical test name.
    return {"ok": True}


@api_router.delete("/options")
async def delete_option(type: str, value: str, dataset: Optional[str] = None, user=Depends(require_master_access)):
    value = str(value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Value is required")

    if type == "test":
        mapped_dataset = await db.datasets.find_one(
            {"$or": [{"tests": value}, {"sample_mappings.tests": value}]},
            {"_id": 0, "name": 1},
        )
        mapped_panel = await db.panels.find_one({"tests": value}, {"_id": 0, "name": 1})
        if mapped_dataset:
            raise HTTPException(status_code=409, detail=f"Remove this test from Dataset Master '{mapped_dataset.get('name', '')}' before deleting it")
        if mapped_panel:
            raise HTTPException(status_code=409, detail=f"Remove this test from Panel '{mapped_panel.get('name', '')}' before deleting it")
        result = await db.options.delete_many({"type": "test", "value": value})
        return {"ok": True, "deleted": result.deleted_count}

    if type == "sample_type":
        mapped_dataset = await db.datasets.find_one(
            {"$or": [{"sample_types": value}, {"sample_mappings.sample_type": value}]},
            {"_id": 0, "name": 1},
        )
        if mapped_dataset:
            raise HTTPException(status_code=409, detail=f"Remove this sample type from Dataset Master '{mapped_dataset.get('name', '')}' before deleting it")

    result = await db.options.delete_many({"type": type, "value": value})
    return {"ok": True, "deleted": result.deleted_count}


@api_router.get("/masters")
async def list_masters(user=Depends(require_master_access)):
    docs = await db.options.find({}, {"_id": 0}).sort([("type", 1), ("value", 1)]).to_list(10000)
    result = {"test": [], "district": [], "sample_type": [], "report_remark": []}

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


@api_router.get("/institutions")
async def list_institutions(search: Optional[str] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if search:
        query["value"] = {"$regex": search, "$options": "i"}
    docs = await db.institutions.find(query, {"_id": 0}).sort("value", 1).limit(100).to_list(100)
    return [doc.get("value") for doc in docs if doc.get("value")]


# ---------- Panel Master ----------
@api_router.get("/panels")
async def list_panels(dataset: Optional[str] = None, active: Optional[bool] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if dataset:
        query["dataset"] = normalize_key(dataset)
    if active is not None:
        query["active"] = active
    return await db.panels.find(query, {"_id": 0}).sort("name", 1).to_list(1000)


@api_router.post("/panels")
async def save_panel(payload: PanelMaster, user=Depends(require_master_access)):
    dataset_key = normalize_key(payload.dataset)
    await get_dataset(dataset_key)

    name = str(payload.name or "").strip()
    tests = list(dict.fromkeys(
        str(item).strip() for item in (payload.tests or []) if str(item).strip()
    ))

    if not name:
        raise HTTPException(status_code=400, detail="Panel name is required")
    if not tests:
        raise HTTPException(status_code=400, detail="Select at least one test")

    supplied_id = str(payload.id or "").strip()
    panel_id = supplied_id or f"panel_{uuid.uuid4().hex[:12]}"

    duplicate = await db.panels.find_one(
        {
            "dataset": dataset_key,
            "name": {"$regex": f"^{re.escape(name)}$", "$options": "i"},
            "id": {"$ne": panel_id},
        },
        {"_id": 0},
    )
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail="A panel with this name already exists in the selected dataset",
        )

    existing = await db.panels.find_one({"id": panel_id}, {"_id": 0})
    doc = {
        "id": panel_id,
        "name": name,
        "dataset": dataset_key,
        "tests": tests,
        "active": bool(payload.active),
        "updated_at": now_iso(),
    }

    if existing:
        await db.panels.update_one({"id": panel_id}, {"$set": doc})
    else:
        doc["created_at"] = now_iso()
        await db.panels.insert_one(doc.copy())

    return {key: value for key, value in doc.items() if key != "_id"}


@api_router.delete("/panels/{panel_id}")
async def delete_panel(panel_id: str, user=Depends(require_master_access)):
    result = await db.panels.delete_one({"id": panel_id})
    if not result.deleted_count:
        raise HTTPException(status_code=404, detail="Panel not found")
    return {"ok": True}


# ---------- Records CRUD ----------
def _apply_filters(query: dict, dataset: Optional[str], test: Optional[str], district: Optional[str], sample_type: Optional[str], result_contains: Optional[str], search: Optional[str], date_from: Optional[str], date_to: Optional[str]):
    clauses = []
    if dataset:
        query["dataset"] = normalize_key(dataset)
    if test:
        clauses.append({"$or": [{"samples.tests.test": test}, {"tests.test": test}, {"test": test}]})
    if district:
        query["district"] = district
    if sample_type:
        clauses.append({"$or": [{"samples.sample_type": sample_type}, {"sample_type": sample_type}]})
    if result_contains:
        regex = {"$regex": result_contains, "$options": "i"}
        clauses.append({"$or": [
            {"samples.tests.result1": regex}, {"samples.tests.result2": regex},
            {"tests.result1": regex}, {"tests.result2": regex},
            {"results.value": regex}, {"results.name": regex},
        ]})
    if search:
        regex = {"$regex": search, "$options": "i"}
        clauses.append({"$or": [
            {"name": regex}, {"lab_number": regex}, {"patient_id": regex},
            {"requesting_institution": regex}, {"epid_number": regex},
            {"samples.tests.test": regex}, {"tests.test": regex},
        ]})
    if clauses:
        query["$and"] = clauses
    if date_from or date_to:
        date_query = {}
        if date_from:
            date_query["$gte"] = date_from
        if date_to:
            date_query["$lte"] = date_to
        query["date"] = date_query


@api_router.post("/records", response_model=LabRecord)
async def create_record(payload: LabRecordCreate, user=Depends(get_current_user)):
    dataset_doc = await get_dataset(payload.dataset)
    samples = await _samples_from_payload(payload, dataset_doc)
    if not samples:
        raise HTTPException(status_code=400, detail="At least one sample with one test is required")

    mr_number = None
    mr_year = None
    if any(
        sample.get("dataset") == "mr_surveillance"
        for sample in samples
    ):
        mr_number, mr_year = await generate_mr_patient_number()
        assign_mr_lab_numbers(samples, mr_number)

    rabies_number = None
    rabies_year = None
    if any(sample.get("dataset") == "rabies" for sample in samples):
        rabies_number, rabies_year = await generate_rabies_patient_number()
        assign_rabies_lab_numbers(samples, rabies_number, rabies_year)

    for sample in samples:
        if (
            sample.get("dataset") not in {"mr_surveillance", "rabies"}
            and not sample.get("lab_number")
        ):
            sample["lab_number"] = await generate_lab_number(
                sample.get("dataset") or dataset_doc["key"]
            )

    lab_number = samples[0]["lab_number"]
    patient_id = await generate_patient_id()
    compatibility = _legacy_from_samples(samples)
    rec = LabRecord(
        patient_id=patient_id,
        dataset=dataset_doc["key"],
        lab_number=lab_number,
        date=payload.date,
        name=payload.name,
        age=payload.age,
        sex=payload.sex,
        district=payload.district or "Trivandrum",
        requesting_institution=payload.requesting_institution,
        epid_number=payload.epid_number,
        mr_patient_number=mr_number,
        mr_sequence_year=mr_year,
        rabies_patient_number=rabies_number,
        rabies_sequence_year=rabies_year,
        samples=samples,
        remarks=payload.remarks,
        created_by=user["user_id"],
        **compatibility,
    )
    doc = rec.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = doc["updated_at"].isoformat()
    await db.records.insert_one(doc)

    institution = str(payload.requesting_institution or "").strip()
    if institution:
        await db.institutions.update_one(
            {"value_lower": institution.lower()},
            {"$set": {"value": institution, "value_lower": institution.lower(), "updated_at": now_iso()}},
            upsert=True,
        )
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
        pending_test = {
            "$or": [
                {"samples.tests": {"$elemMatch": {"result1": {"$in": [None, ""]}, "result2": {"$in": [None, ""]}}}},
                {"tests": {"$elemMatch": {"result1": {"$in": [None, ""]}, "result2": {"$in": [None, ""]}}}},
                {"samples": {"$size": 0}}, {"samples": {"$exists": False}},
            ]
        }
        if test:
            pending_test = {"$or": [
                {"samples.tests": {"$elemMatch": {"test": test, "result1": {"$in": [None, ""]}, "result2": {"$in": [None, ""]}}}},
                {"tests": {"$elemMatch": {"test": test, "result1": {"$in": [None, ""]}, "result2": {"$in": [None, ""]}}}},
            ]}
        query.setdefault("$and", []).append(pending_test)
    elif pending is False:
        query.setdefault("$and", []).append({"$or": [{"samples.0": {"$exists": True}}, {"tests.0": {"$exists": True}}]})

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
    update = {key: value for key, value in raw.items() if value is not None and key != "auto_assign_tests"}
    dataset_doc = await get_dataset(update.get("dataset") or existing.get("dataset") or "routine")
    if "dataset" in update:
        update["dataset"] = dataset_doc["key"]

    sample_fields = {"samples", "sample_type", "tests", "test", "results", "result_date", "auto_assign_tests"}
    if sample_fields.intersection(raw):
        samples = await _samples_from_payload(payload, dataset_doc)
        if not samples:
            raise HTTPException(status_code=400, detail="At least one sample with one test is required")

        existing_by_id = {
            str(sample.get("id")): sample
            for sample in (existing.get("samples") or [])
            if sample.get("id")
        }
        mr_number = existing.get("mr_patient_number")
        mr_year = existing.get("mr_sequence_year")

        if any(
            sample.get("dataset") == "mr_surveillance"
            for sample in samples
        ):
            if not mr_number:
                mr_number, mr_year = await generate_mr_patient_number()
            assign_mr_lab_numbers(samples, int(mr_number))
            update["mr_patient_number"] = int(mr_number)
            update["mr_sequence_year"] = int(mr_year)

        rabies_number = existing.get("rabies_patient_number")
        rabies_year = existing.get("rabies_sequence_year")
        if any(sample.get("dataset") == "rabies" for sample in samples):
            if not rabies_number:
                rabies_number, rabies_year = await generate_rabies_patient_number()
            assign_rabies_lab_numbers(samples, int(rabies_number), int(rabies_year))
            update["rabies_patient_number"] = int(rabies_number)
            update["rabies_sequence_year"] = int(rabies_year)

        for sample in samples:
            previous = existing_by_id.get(str(sample.get("id")))
            if (
                sample.get("dataset") not in {"mr_surveillance", "rabies"}
                and not sample.get("lab_number")
                and previous
            ):
                sample["lab_number"] = previous.get("lab_number")
            if (
                sample.get("dataset") not in {"mr_surveillance", "rabies"}
                and not sample.get("lab_number")
            ):
                sample["lab_number"] = await generate_lab_number(
                    sample.get("dataset") or dataset_doc["key"]
                )

        update["samples"] = samples
        update["lab_number"] = samples[0]["lab_number"]
        update.update(_legacy_from_samples(samples))

    if not existing.get("patient_id"):
        update["patient_id"] = await generate_patient_id()

    if not update:
        raise HTTPException(status_code=400, detail="Nothing to update")
    update["updated_at"] = now_iso()
    await db.records.update_one({"id": rid}, {"$set": update})

    institution = str(update.get("requesting_institution") or "").strip()
    if institution:
        await db.institutions.update_one(
            {"value_lower": institution.lower()},
            {"$set": {"value": institution, "value_lower": institution.lower(), "updated_at": now_iso()}},
            upsert=True,
        )
    return _serialize_record(await db.records.find_one({"id": rid}, {"_id": 0}))


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

    matched = modified = 0
    for rid in payload.ids:
        record = await db.records.find_one({"id": rid}, {"_id": 0})
        if not record:
            continue
        serialized = _serialize_record(record)
        samples = serialized.get("samples") or []
        changed = False
        for sample in samples:
            if payload.sample_id and sample.get("id") != payload.sample_id:
                continue
            for item in sample.get("tests") or []:
                if str(item.get("test") or "").strip() == payload.test.strip():
                    matched += 1
                    item["result1"] = payload.result1 or ""
                    item["result2"] = payload.result2 or ""
                    item["result_date"] = payload.result_date or item.get("result_date")
                    if payload.remarks is not None:
                        item["remarks"] = payload.remarks
                    changed = True
                    break
            if changed:
                break
        if not changed:
            continue
        compatibility = _legacy_from_samples(samples)
        result = await db.records.update_one(
            {"id": rid},
            {"$set": {"samples": samples, **compatibility, "updated_at": now_iso()}},
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
            sex = _get_cell(row_dict, "sex", "gender")
            institution = _get_cell(row_dict, "requesting_institution", "institution")
            epid_number = _get_cell(row_dict, "epid_number", "epid")

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
                    "sex": str(sex).strip() if sex is not None else None,
                    "requesting_institution": str(institution).strip() if institution is not None else None,
                    "epid_number": str(epid_number).strip() if epid_number is not None else None,
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
            sample = {"id": f"sample_{uuid.uuid4().hex[:12]}", "sample_type": group["sample_type"], "tests": _validate_tests(group["tests"]), "remarks": None}
            samples = [sample]
            legacy = _legacy_from_samples(samples)
            rec = {
                "id": str(uuid.uuid4()),
                "patient_id": await generate_patient_id(),
                "dataset": group["dataset"],
                "lab_number": lab_number,
                "date": group["date"],
                "name": group["name"],
                "age": group["age"],
                "district": group["district"],
                "sex": group.get("sex"),
                "requesting_institution": group.get("requesting_institution"),
                "epid_number": group.get("epid_number"),
                "samples": samples,
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
    for record in records:
        record = _serialize_record(record)
        samples = record.get("samples") or []
        if not samples:
            samples = [{"sample_type": record.get("sample_type", ""), "tests": record.get("tests") or []}]
        first_row = True
        for sample in samples:
            tests = sample.get("tests") or [{"test": "", "result1": "", "result2": "", "result_date": ""}]
            for test in tests:
                rows.append({
                    "Lab Number": sample.get("lab_number", "") or record.get("lab_number", ""),
                    "Date": record.get("date", "") if first_row else "",
                    "Name": record.get("name", "") if first_row else "",
                    "Age": record.get("age", "") if first_row else "",
                    "Sex": record.get("sex", "") if first_row else "",
                    "District": record.get("district", "") if first_row else "",
                    "Requesting Institution": record.get("requesting_institution", "") if first_row else "",
                    "EPID Number": record.get("epid_number", "") if first_row else "",
                    "Sample Type": sample.get("sample_type", ""),
                    "Test": test.get("test", ""),
                    "Result 1": test.get("result1", ""),
                    "Result 2": test.get("result2", ""),
                    "Result Date": test.get("result_date", ""),
                    "Test Remarks": test.get("remarks", ""),
                    "Remarks": record.get("remarks", "") if first_row else "",
                })
                first_row = False
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
            matched_samples = []
            for sample in serialized.get("samples") or []:
                matched_tests = [item for item in (sample.get("tests") or []) if str(item.get("test") or "") == test]
                if matched_tests:
                    matched_samples.append({**sample, "tests": matched_tests})
            if matched_samples:
                serialized["samples"] = matched_samples
                serialized.update(_legacy_from_samples(matched_samples))
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
        "Sex": "",
        "District": "Trivandrum",
        "Requesting Institution": "",
        "EPID Number": "",
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


# ---------- Version 2.1 Reports ----------
def _parse_day(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d")
    except (TypeError, ValueError):
        return None


def _tat_days(record_date: Optional[str], result_date: Optional[str]) -> Optional[int]:
    start, end = _parse_day(record_date), _parse_day(result_date)
    return (end - start).days if start and end else None


@api_router.get("/reports/tat")
async def tat_report(date_from: Optional[str] = None, date_to: Optional[str] = None, dataset: Optional[str] = None, test: Optional[str] = None, district: Optional[str] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if date_from or date_to:
        query["date"] = {}
        if date_from: query["date"]["$gte"] = date_from
        if date_to: query["date"]["$lte"] = date_to
    if dataset: query["dataset"] = normalize_key(dataset)
    if district: query["district"] = district
    records = await db.records.find(query, {"_id": 0}).sort("date", 1).to_list(100000)
    points = []
    for raw in records:
        record = _serialize_record(raw)
        for item in _all_tests(record):
            if test and item.get("test") != test: continue
            tat = _tat_days(record.get("date"), item.get("result_date"))
            if tat is None: continue
            points.append({"record_id": record.get("id"), "lab_number": record.get("lab_number"), "dataset": record.get("dataset"), "date": record.get("date"), "result_date": item.get("result_date"), "test": item.get("test"), "tat_days": tat})
    values=sorted([p["tat_days"] for p in points])
    median=None
    if values:
        m=len(values)//2
        median=values[m] if len(values)%2 else (values[m-1]+values[m])/2
    return {"points": points, "summary": {"count": len(values), "average": round(sum(values)/len(values),2) if values else None, "median": median, "minimum": min(values) if values else None, "maximum": max(values) if values else None}}


@api_router.get("/reports/test-statistics")
async def test_statistics_report(date_from: Optional[str] = None, date_to: Optional[str] = None, dataset: Optional[str] = None, district: Optional[str] = None, user=Depends(get_current_user)):
    query: Dict[str, Any] = {}
    if date_from or date_to:
        query["date"] = {}
        if date_from: query["date"]["$gte"] = date_from
        if date_to: query["date"]["$lte"] = date_to
    if dataset: query["dataset"] = normalize_key(dataset)
    if district: query["district"] = district
    records=await db.records.find(query,{"_id":0}).to_list(100000)
    stats={}
    for raw in records:
        for item in _all_tests(_serialize_record(raw)):
            name=str(item.get("test") or "").strip()
            if not name: continue
            row=stats.setdefault(name,{"test":name,"total":0,"positive":0,"negative":0,"indeterminate":0,"pending":0})
            row["total"]+=1
            result=str(item.get("result1") or "").strip().lower()
            if result=="positive": row["positive"]+=1
            elif result=="negative": row["negative"]+=1
            elif result=="indeterminate": row["indeterminate"]+=1
            else: row["pending"]+=1
    rows=[]
    for row in stats.values():
        completed=row["positive"]+row["negative"]+row["indeterminate"]
        row["positivity_rate"]=round(row["positive"]/completed*100,2) if completed else 0
        rows.append(row)
    rows.sort(key=lambda x:x["test"].lower())
    return {"items": rows, "total_tests": sum(x["total"] for x in rows)}


# ---------- Stats ----------
@api_router.get("/stats")
async def stats(user=Depends(get_current_user)):
    total = await db.records.count_documents({})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_count = await db.records.count_documents({"date": today})
    pending = await db.records.count_documents({
        "$or": [
            {"samples": {"$size": 0}},
            {"samples": {"$exists": False}},
            {"samples.tests.result1": {"$in": [None, ""]}},
            {"tests.result1": {"$in": [None, ""]}},
        ]
    })
    districts = len(await db.records.distinct("district"))
    tests_agg = await db.records.aggregate([
        {"$project": {"all_tests": {"$cond": [{"$gt": [{"$size": {"$ifNull": ["$samples", []]}}, 0]}, {"$reduce": {"input": "$samples", "initialValue": [], "in": {"$concatArrays": ["$$value", {"$ifNull": ["$$this.tests", []]}]}}}, {"$ifNull": ["$tests", []]}]}}},
        {"$unwind": {"path": "$all_tests", "preserveNullAndEmptyArrays": True}},
        {"$group": {"_id": "$all_tests.test", "count": {"$sum": 1}}},
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


# ---------- Test data reset ----------
@api_router.delete("/admin/operational-data")
async def clear_operational_data(confirm: str, user=Depends(get_current_user)):
    """
    Delete dummy operational data while preserving datasets, options, panels,
    institutions, users, backup settings and all other configuration.
    """
    if confirm != "DELETE DUMMY DATA":
        raise HTTPException(
            status_code=400,
            detail='Confirmation must be exactly: DELETE DUMMY DATA',
        )

    records_deleted = (await db.records.delete_many({})).deleted_count
    counters_deleted = (
        await db.counters.delete_many(
            {
                "$or": [
                    {"key": {"$regex": "^patient_"}},
                    {"key": {"$regex": "^lab_"}},
                ]
            }
        )
    ).deleted_count

    return {
        "ok": True,
        "records_deleted": records_deleted,
        "counters_deleted": counters_deleted,
        "preserved": [
            "datasets",
            "options",
            "panels",
            "institutions",
            "users",
            "backup_settings",
        ],
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
