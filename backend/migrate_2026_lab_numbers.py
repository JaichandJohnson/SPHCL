import asyncio
import os
import re
from collections import defaultdict

from motor.motor_asyncio import AsyncIOMotorClient

DB_NAME = os.environ.get("DB_NAME", "")
MONGO_URL = os.environ.get("TEST_MONGO_URL", "")
MODE = os.environ.get("MIGRATION_MODE", "preview").lower()

EXPECTED_RECORDS = 917
EXPECTED_AFFECTED_RECORDS = 902
EXPECTED_FIELDS = 1807

YEAR_SUFFIX = re.compile(r"/\d{2}$")


def updated_number(value):
    if not isinstance(value, str) or not value.strip():
        return None

    if YEAR_SUFFIX.search(value.strip()):
        return None

    return value + "/26"


async def main():
    if DB_NAME != "mds_lims_test":
        raise RuntimeError("Only mds_lims_test is permitted.")

    if MODE not in ("preview", "apply"):
        raise RuntimeError("Invalid migration mode.")

    if not MONGO_URL:
        raise RuntimeError("TEST_MONGO_URL is missing.")

    client = AsyncIOMotorClient(
        MONGO_URL,
        serverSelectionTimeoutMS=10000,
    )

    try:
        db = client[DB_NAME]

        connection = await db.command("connectionStatus")
        users = connection.get("authInfo", {}).get(
            "authenticatedUsers", []
        )

        if not any(
            user.get("user") == "mds_restore_test"
            and user.get("db") == "admin"
            for user in users
        ):
            raise RuntimeError(
                "Safety check failed: restricted test user required."
            )

        records = await db.records.find({}).to_list(length=None)

        affected = []
        field_count = 0
        number_owners = defaultdict(set)

        for record in records:
            record_id = record["_id"]
            changes = {}
            samples = record.get("samples") or []

            old_record_number = record.get("lab_number")
            new_record_number = updated_number(old_record_number)

            if new_record_number is not None:
                changes["lab_number"] = new_record_number
                field_count += 1

            for index, sample in enumerate(samples):
                old_number = sample.get("lab_number")
                new_number = updated_number(old_number)

                if new_number is not None:
                    changes[
                        f"samples.{index}.lab_number"
                    ] = new_number
                    field_count += 1

                final_number = (
                    new_number
                    if new_number is not None
                    else old_number
                )

                if isinstance(final_number, str) and final_number:
                    dataset = sample.get("dataset") or record.get(
                        "dataset"
                    )
                    number_owners[
                        (dataset, final_number)
                    ].add(str(record_id))

            if changes:
                affected.append((record_id, changes))

        duplicates = [
            key
            for key, owners in number_owners.items()
            if len(owners) > 1
        ]

        if duplicates:
            raise RuntimeError(
                f"Duplicate laboratory numbers detected: "
                f"{duplicates[:10]}"
            )

        print(f"Mode: {MODE}")
        print(f"Total records: {len(records)}")
        print(f"Affected records: {len(affected)}")
        print(f"Fields to update: {field_count}")
        print(f"Duplicate groups: {len(duplicates)}")

        if (
            len(records) != EXPECTED_RECORDS
            or len(affected) != EXPECTED_AFFECTED_RECORDS
            or field_count != EXPECTED_FIELDS
        ):
            raise RuntimeError(
                "Expected counts do not match. Migration stopped."
            )

        if MODE == "preview":
            print("PREVIEW COMPLETE - NO DATABASE CHANGES")
            return

        print("Starting test database migration...")

        updated_records = 0

        for record_id, changes in affected:
            original = next(
                r for r in records if r["_id"] == record_id
            )

            conditions = {"_id": record_id}

            for field in changes:
                if field == "lab_number":
                    conditions[field] = original.get("lab_number")
                else:
                    parts = field.split(".")
                    index = int(parts[1])
                    conditions[field] = original["samples"][index].get(
                        "lab_number"
                    )

            result = await db.records.update_one(
                conditions,
                {"$set": changes},
            )

            if result.modified_count != 1:
                raise RuntimeError(
                    f"Update failed for record {record_id}"
                )

            updated_records += 1

        print(f"Updated records: {updated_records}")
        print("TEST DATABASE MIGRATION COMPLETE")

    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
