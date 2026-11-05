"""MongoDB synchronization outbox foundation (not wired into production routes).

Use record_change_with_outbox only when MongoDB transactions are supported.
The record mutation and its outbox event are committed together or not at all.
No network requests are made by this module.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from pymongo.errors import DuplicateKeyError


class SyncPreconditionError(RuntimeError):
    pass


def new_outbox_event(
    *, origin_id: str, collection: str, document_id: str,
    operation: str, base_revision: Optional[str], revision: str,
    payload: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    if not origin_id or not document_id or not revision:
        raise ValueError("origin_id, document_id and revision are required")
    if collection not in {"records", "datasets", "options", "panels", "tat_thresholds"}:
        raise ValueError("Collection is not approved for synchronization")
    if operation not in {"upsert", "delete"}:
        raise ValueError("Unsupported operation")
    if operation == "upsert" and payload is None:
        raise ValueError("Upsert requires a payload")
    if operation == "delete" and payload is not None:
        raise ValueError("Delete event must not contain a payload")
    return {
        "event_id": str(uuid4()),
        "origin_id": origin_id,
        "collection": collection,
        "document_id": document_id,
        "operation": operation,
        "base_revision": base_revision,
        "revision": revision,
        "occurred_at": datetime.now(timezone.utc),
        "payload": payload,
        "status": "pending",
        "attempts": 0,
    }


async def ensure_outbox_indexes(db) -> None:
    """Call during an explicitly enabled sync migration, not app startup."""
    await db.sync_outbox.create_index("event_id", unique=True)
    await db.sync_outbox.create_index([("status", 1), ("occurred_at", 1)])


async def record_change_with_outbox(
    db, *, collection: str, document_id: str, expected_revision: Optional[str],
    replacement: Dict[str, Any], origin_id: str,
) -> Dict[str, Any]:
    """Atomically replace an existing versioned document and enqueue the event.

    This deliberately does not handle record creation, deletion or legacy
    documents lacking _sync_revision. Those require a reviewed migration.
    Callers must perform domain validation and authorization first.
    """
    if collection not in {"records", "datasets", "options", "panels", "tat_thresholds"}:
        raise ValueError("Collection is not approved for synchronization")
    if not expected_revision:
        raise SyncPreconditionError("Existing revision is required; migrate legacy data first")
    if replacement.get("id") != document_id:
        raise SyncPreconditionError("Replacement document ID mismatch")
    if "_id" in replacement:
        raise SyncPreconditionError("MongoDB _id must not be supplied")
    if any(k.startswith("_sync_") for k in replacement):
        raise SyncPreconditionError("Sync metadata is server-controlled")

    revision = str(uuid4())
    new_document = dict(replacement)
    new_document["_sync_revision"] = revision
    event = new_outbox_event(
        origin_id=origin_id, collection=collection, document_id=document_id,
        operation="upsert", base_revision=expected_revision,
        revision=revision, payload=new_document,
    )

    # Motor client.start_session() is async; transaction requires a replica set
    # or sharded deployment. Standalone MongoDB must not use this path.
    async with await db.client.start_session() as session:
        async with session.start_transaction():
            result = await db[collection].replace_one(
                {"id": document_id, "_sync_revision": expected_revision},
                new_document, upsert=False, session=session,
            )
            if result.matched_count != 1:
                raise SyncPreconditionError("Document changed or is missing; do not overwrite")
            await db.sync_outbox.insert_one(event, session=session)
    return {"event_id": event["event_id"], "revision": revision}


async def get_pending_outbox(db, limit: int = 100) -> list[dict]:
    """Read-only queue inspection; does not transmit or acknowledge events."""
    if not 1 <= limit <= 500:
        raise ValueError("limit must be between 1 and 500")
    return await db.sync_outbox.find(
        {"status": "pending"}, {"_id": 0}
    ).sort("occurred_at", 1).limit(limit).to_list(length=limit)
