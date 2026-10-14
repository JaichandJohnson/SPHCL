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
        serverSelectionTimeoutMS=10000
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
                changes["lab_number"] =
