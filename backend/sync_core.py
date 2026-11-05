"""Pure synchronization primitives for MDS LIMS.

This module does not connect to either database or start synchronization.
It is intentionally safe to import while the feature is under development.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, Literal, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


class SyncOperation(str, Enum):
    UPSERT = "upsert"
    DELETE = "delete"


class SyncEvent(BaseModel):
    """Immutable description of a locally committed change.

    Events must be written atomically with the corresponding data mutation
    before any network transmission is attempted.
    """

    event_id: str = Field(default_factory=lambda: str(uuid4()))
    origin_id: str
    collection: Literal["records", "datasets", "options", "panels", "tat_thresholds"]
    document_id: str
    operation: SyncOperation
    base_revision: Optional[str] = None
    revision: str
    occurred_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    payload: Optional[Dict[str, Any]] = None


def canonical_digest(document: Dict[str, Any]) -> str:
    """Stable digest for JSON-compatible data; excludes MongoDB's local _id.

    This is a comparison aid, NOT a concurrency/version identifier. A revision
    must be assigned at the time a write commits.
    """
    filtered = {key: value for key, value in document.items() if key != "_id"}
    encoded = json.dumps(
        filtered, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        default=_json_default,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _json_default(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat() if value.tzinfo else value.isoformat()
    raise TypeError(f"Unsupported sync value: {type(value).__name__}")


def classify_incoming(
    *, incoming_event_id: str, incoming_base_revision: Optional[str],
    incoming_revision: str, current_revision: Optional[str],
    already_applied: bool,
) -> Literal["duplicate", "apply", "conflict"]:
    """Conservative conflict decision; never silently overwrite divergent edits.

    A first-time create has no base revision. Updates/deletes must reference
    the exact revision that the receiver currently holds.
    """
    if already_applied or incoming_revision == current_revision:
        return "duplicate"
    if incoming_base_revision == current_revision:
        return "apply"
    return "conflict"
