import asyncio
import os
import re
from collections import defaultdict
from urllib.parse import urlsplit, unquote

from motor.motor_asyncio import AsyncIOMotorClient

DB_NAME = "mds_lims_test"
BACKUP_NAME = "records_backup_before_2026_migration"
EXPECTED_RECORDS = 917
EXPECTED_CHANGED_RECORDS = 902
EXPECTED_CHANGED_FIELDS = 1807
YEAR_RE = re.compile(r"/\d{2}$")


def target_number(value):
    if not isinstance(value, str) or not value.strip() or YEAR_RE.search(value.strip()):
        return value
    return value + "/26"


def number_fields(record):
    result = {"lab_number": record.get("lab_number")}
    for i, sample in enumerate(record.get("samples") or []):
        result[f"samples.{i}.lab_number"] = sample.get("lab_number")
    return result


def get_path(record, path):
    if path == "lab_number":
        return record.get("lab_number")
    i = int(path.split(".")[1])
    return record["samples"][i].get("lab_number")


def ownership_conflicts(records, transform):
    owners = defaultdict(set)
    for record in records:
        rid = str(record["_id"])
        for sample in record.get("samples") or []:
            value = sample.get("lab_number")
            if not isinstance(value, str) or not value.strip():
                continue
            dataset = sample.get("dataset") or record.get("dataset")
            owners[(str(dataset), transform(value))].add(rid)
    return [key for key, ids in owners.items() if len(ids) > 1]


def verify_snapshot(originals, backups):
    if len(originals) != EXPECTED_RECORDS or len(backups) != EXPECTED_RECORDS:
        raise RuntimeError("Record count differs from expected 917")
    orig = {r["_id"]: r for r in originals}
    back = {r["_id"]: r for r in backups}
    if orig.keys() != back.keys():
        raise RuntimeError("Backup record IDs differ from original")
    for rid, record in orig.items():
        if number_fields(record) != number_fields(back[rid]):
            raise RuntimeError(f"Backup lab numbers differ for record {rid}")
    return back


def planned_changes(originals):
    changes = []
    fields = 0
    for record in originals:
        updates = {}
        for path, value in number_fields(record).items():
            new_value = target_number(value)
            if new_value != value:
                updates[path] = (value, new_value)
                fields += 1
        if updates:
            changes.append((record["_id"], updates))
    if len(changes) != EXPECTED_CHANGED_RECORDS or fields != EXPECTED_CHANGED_FIELDS:
        raise RuntimeError(
            f"Unexpected changes: {len(changes)} records / {fields} fields"
        )
    return changes, fields


async def main():
    mode = os.getenv("MIGRATION_MODE", "preview").strip().lower()
    if mode not in ("preview", "apply"):
        raise RuntimeError("MIGRATION_MODE must be preview or apply")
    if os.getenv("DB_NAME") != DB_NAME:
        raise RuntimeError("Safety stop: DB_NAME must be mds_lims_test")
    url = os.getenv("TEST_MONGO_URL", "")
    if not url:
        raise RuntimeError("TEST_MONGO_URL missing")
    username = unquote(urlsplit(url).username or "")
    if username != "mds_restore_test":
        raise RuntimeError("Safety stop: restricted test user required")
    if mode == "apply" and os.getenv("CONFIRM_TEST_MIGRATION") != "APPLY_TO_MDS_LIMS_TEST":
        raise RuntimeError("Explicit test migration confirmation missing")

    client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=10000)
    try:
        db = client[DB_NAME]
        auth = (await db.command("connectionStatus")).get("authInfo", {}).get("authenticatedUsers", [])
        if not any(u.get("user") == "mds_restore_test" for u in auth):
            raise RuntimeError("Authenticated MongoDB user is not mds_restore_test")
        if BACKUP_NAME not in await db.list_collection_names():
            raise RuntimeError("Backup collection missing")

        originals = await db.records.find({}).to_list(length=None)
        backups = await db[BACKUP_NAME].find({}).to_list(length=None)
        backup_by_id = verify_snapshot(originals, backups)
        changes, fields = planned_changes(originals)
        conflicts = ownership_conflicts(originals, target_number)
        if conflicts:
            raise RuntimeError(f"Cross-record duplicate numbers after migration: {conflicts[:5]}")
        print(f"Mode: {mode}")
        print(f"Backup verified: {len(backups)} records and matching laboratory-number fields")
        print(f"Records to update: {len(changes)}")
        print(f"Fields to update: {fields}")
        print("Cross-record duplicate groups: 0")
        if mode == "preview":
            print("PREVIEW COMPLETE - NO DATABASE CHANGES")
            return

        updated = 0
        try:
            for rid, updates in changes:
                condition = {"_id": rid}
                for path, (old, _) in updates.items():
                    condition[path] = old
                result = await db.records.update_one(
                    condition,
                    {"$set": {path: new for path, (_, new) in updates.items()}},
                )
                if result.modified_count != 1:
                    raise RuntimeError(f"Concurrent change or failed update for record {rid}")
                updated += 1
        except Exception:
            print(f"PARTIAL MIGRATION POSSIBLE: {updated} records updated before failure")
            raise

        after = await db.records.find({}).to_list(length=None)
        after_by_id = {r["_id"]: r for r in after}
        if after_by_id.keys() != backup_by_id.keys():
            raise RuntimeError("POST-CHECK FAILED: record IDs changed")
        checked_fields = 0
        for rid, before in backup_by_id.items():
            expected = {p: target_number(v) for p, v in number_fields(before).items()}
            actual = number_fields(after_by_id[rid])
            if expected != actual:
                raise RuntimeError(f"POST-CHECK FAILED: laboratory numbers differ for {rid}")
            checked_fields += sum(
                1 for p, v in number_fields(before).items() if expected[p] != v
            )
        if checked_fields != EXPECTED_CHANGED_FIELDS:
            raise RuntimeError("POST-CHECK FAILED: updated field count mismatch")
        if ownership_conflicts(after, lambda value: value):
            raise RuntimeError("POST-CHECK FAILED: duplicate laboratory numbers")
        print(f"Updated records: {updated}")
        print(f"Verified changed fields: {checked_fields}")
        print("TEST MIGRATION AND POST-CHECKS PASSED")
    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
