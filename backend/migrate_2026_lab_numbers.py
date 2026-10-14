import asyncio
import os
import re

from motor.motor_asyncio import AsyncIOMotorClient

DB_NAME = os.environ.get("DB_NAME", "")
MONGO_URL = os.environ.get("TEST_MONGO_URL", "")

YEAR_SUFFIX = re.compile(r"/\d{2}$")


def updated_number(value):
    if not isinstance(value, str) or not value.strip():
        return None

    if YEAR_SUFFIX.search(value.strip()):
        return None

    return value + "/26"


async def main():
    if DB_NAME != "mds_lims_test":
        raise RuntimeError("Safety check failed: test database required.")

    if not MONGO_URL:
        raise RuntimeError("TEST_MONGO_URL is not configured.")

    client = AsyncIOMotorClient(MONGO_URL)

    try:
        db = client[DB_NAME]

        total_records = 0
        affected_records = 0
        record_numbers = 0
        specimen_numbers = 0
        examples = []

        async for record in db.records.find(
            {},
            {"lab_number": 1, "samples.lab_number": 1}
        ):
            total_records += 1
            changed = False

            old = record.get("lab_number")
            new = updated_number(old)

            if new is not None:
                record_numbers += 1
                changed = True

                if len(examples) < 10:
                    examples.append((old, new))

            for sample in record.get("samples", []):
                old = sample.get("lab_number")
                new = updated_number(old)

                if new is not None:
                    specimen_numbers += 1
                    changed = True

                    if len(examples) < 10:
                        examples.append((old, new))

            if changed:
                affected_records += 1

        print("PREVIEW ONLY - NO DATABASE CHANGES")
        print(f"Total records examined: {total_records}")
        print(f"Records requiring changes: {affected_records}")
        print(f"Record-level numbers to update: {record_numbers}")
        print(f"Specimen-level numbers to update: {specimen_numbers}")
        print(f"Total fields to update: {record_numbers + specimen_numbers}")

        print("\nExamples:")
        for old, new in examples:
            print(f"  {old} -> {new}")

    finally:
        client.close()


if __name__ == "__main__":
    asyncio.run(main())
