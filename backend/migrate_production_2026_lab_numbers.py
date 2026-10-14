"""One-time 2026 lab-number migration. Preview is default; apply is explicit.

Requires PROD_MONGO_URL, DB_NAME=sphcl_lab. Never commit connection strings.
Before apply: verify an independently restorable production backup and pause writes.
"""
import asyncio
import os
import re
from collections import defaultdict
from urllib.parse import urlsplit, unquote
from motor.motor_asyncio import AsyncIOMotorClient

DB_NAME = 'sphcl_lab'
PRODUCTION_USER = 'jaichand_db_user'
YEAR_RE = re.compile(r'/\d{2}$')
EXPECTED_RECORDS = 917
EXPECTED_CHANGED_RECORDS = 902
EXPECTED_CHANGED_FIELDS = 1807


def target_number(value):
    if not isinstance(value, str) or not value.strip() or YEAR_RE.search(value.strip()):
        return value
    return value + '/26'


def number_fields(record):
    result = {'lab_number': record.get('lab_number')}
    for i, sample in enumerate(record.get('samples') or []):
        result[f'samples.{i}.lab_number'] = sample.get('lab_number')
    return result


def ownership_conflicts(records, transform):
    owners = defaultdict(set)
    for record in records:
        rid = str(record['_id'])
        for sample in record.get('samples') or []:
            value = sample.get('lab_number')
            if not isinstance(value, str) or not value.strip():
                continue
            dataset = sample.get('dataset') or record.get('dataset')
            owners[(str(dataset), transform(value))].add(rid)
    return [key for key, ids in owners.items() if len(ids) > 1]


def planned_changes(records):
    changes = []
    fields = 0
    for record in records:
        updates = {}
        for path, value in number_fields(record).items():
            new = target_number(value)
            if new != value:
                updates[path] = (value, new)
                fields += 1
        if updates:
            changes.append((record['_id'], updates))
    return changes, fields


async def main():
    mode = os.getenv('MIGRATION_MODE', 'preview').strip().lower()
    if mode not in ('preview', 'apply'):
        raise RuntimeError('Invalid MIGRATION_MODE')
    if os.getenv('DB_NAME') != DB_NAME:
        raise RuntimeError('Safety stop: DB_NAME must be sphcl_lab')
    url = os.getenv('PROD_MONGO_URL', '')
    if not url:
        raise RuntimeError('PROD_MONGO_URL missing')
    if unquote(urlsplit(url).username or '') != PRODUCTION_USER:
        raise RuntimeError('Safety stop: production MongoDB username mismatch')
    if mode == 'apply':
        if os.getenv('CONFIRM_PRODUCTION_MIGRATION') != 'APPLY_2026_TO_SPHCL_LAB':
            raise RuntimeError('Explicit production confirmation missing')
        if os.getenv('CONFIRM_BACKUP_RESTORABLE') != 'YES':
            raise RuntimeError('Confirm independently verified restorable backup first')
        if os.getenv('CONFIRM_WRITES_PAUSED') != 'YES':
            raise RuntimeError('Confirm production writes are paused first')

    client = AsyncIOMotorClient(url, serverSelectionTimeoutMS=10000)
    try:
        db = client[DB_NAME]
        auth = (await db.command('connectionStatus')).get('authInfo', {}).get('authenticatedUsers', [])
        if not any(u.get('user') == PRODUCTION_USER for u in auth):
            raise RuntimeError('Authenticated MongoDB user mismatch')
        originals = await db.records.find({}).to_list(length=None)
        changes, field_count = planned_changes(originals)
        conflicts = ownership_conflicts(originals, target_number)
        print(f'Mode: {mode}')
        print(f'Total records: {len(originals)}')
        print(f'Records to update: {len(changes)}')
        print(f'Fields to update: {field_count}')
        print(f'Cross-record duplicate groups: {len(conflicts)}')
        if conflicts:
            raise RuntimeError(f'Duplicate laboratory numbers would result: {conflicts[:5]}')
        if (len(originals), len(changes), field_count) != (
            EXPECTED_RECORDS, EXPECTED_CHANGED_RECORDS, EXPECTED_CHANGED_FIELDS
        ):
            raise RuntimeError('Production counts differ from tested snapshot; stop and investigate')
        if mode == 'preview':
            print('PREVIEW COMPLETE - NO DATABASE CHANGES')
            return

        before = {r['_id']: number_fields(r) for r in originals}
        updated = 0
        try:
            for rid, updates in changes:
                condition = {'_id': rid, **{p: old for p, (old, _) in updates.items()}}
                result = await db.records.update_one(
                    condition,
                    {'$set': {p: new for p, (_, new) in updates.items()}},
                )
                if result.modified_count != 1:
                    raise RuntimeError(f'Concurrent change or failed update for record {rid}')
                updated += 1
        except Exception:
            print(f'PARTIAL MIGRATION POSSIBLE: {updated} records updated; do not rerun blindly')
            raise

        after = await db.records.find({}).to_list(length=None)
        after_by_id = {r['_id']: r for r in after}
        if len(after) != len(originals) or after_by_id.keys() != before.keys():
            raise RuntimeError('POST-CHECK FAILED: record IDs or count changed')
        checked = 0
        for rid, original_fields in before.items():
            expected = {p: target_number(v) for p, v in original_fields.items()}
            if number_fields(after_by_id[rid]) != expected:
                raise RuntimeError(f'POST-CHECK FAILED: laboratory numbers differ for {rid}')
            checked += sum(expected[p] != v for p, v in original_fields.items())
        if checked != EXPECTED_CHANGED_FIELDS or ownership_conflicts(after, lambda v: v):
            raise RuntimeError('POST-CHECK FAILED: counts or duplicates')
        print(f'Updated records: {updated}')
        print(f'Verified changed fields: {checked}')
        print('PRODUCTION MIGRATION AND POST-CHECKS PASSED')
    finally:
        client.close()


if __name__ == '__main__':
    asyncio.run(main())
