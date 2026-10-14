
import asyncio
import os
import unittest
import uuid

from motor.motor_asyncio import AsyncIOMotorClient
from pymongo.errors import DuplicateKeyError


class TestUniqueLabNumberIndex(unittest.IsolatedAsyncioTestCase):

    async def test_duplicate_lab_number_rejected(self):
        mongo_url = os.environ.get("MONGO_URL", "")
        db_name = os.environ.get("DB_NAME", "")

        if db_name != "mds_lims_test":
            self.fail("Unsafe database name")

        if not mongo_url.startswith(
            "mongodb+srv://mds_restore_test:"
        ):
            self.fail("Unsafe MongoDB connection")

        client = AsyncIOMotorClient(mongo_url)
        records = client[db_name]["records"]

        token = uuid.uuid4().hex
        lab_number = f"QA UNIQUE {token}"
        inserted_ids = []

        try:
            indexes = await records.index_information()
            expected = [
                ("samples.dataset", 1),
                ("samples.lab_number", 1),
            ]

            self.assertTrue(
                any(
                    index.get("unique") is True
                    and index.get("key") == expected
                    for index in indexes.values()
                ),
                "Required unique compound index not found",
            )

            first = {
                "id": str(uuid.uuid4()),
                "dataset": "qa_unique_index",
                "lab_number": lab_number,
                "samples": [{
                    "dataset": "qa_unique_index",
                    "sample_type": "Serum",
                    "lab_number": lab_number,
                }],
                "qa_test_token": token,
            }

            second = {
                "id": str(uuid.uuid4()),
                "dataset": "qa_unique_index",
                "lab_number": lab_number,
                "samples": [{
                    "dataset": "qa_unique_index",
                    "sample_type": "Serum",
                    "lab_number": lab_number,
                }],
                "qa_test_token": token,
            }

            result = await records.insert_one(first)
            inserted_ids.append(result.inserted_id)

            with self.assertRaises(DuplicateKeyError):
                await records.insert_one(second)

            count = await records.count_documents({
                "qa_test_token": token
            })

            self.assertEqual(count, 1)

        finally:
            try:
                await records.delete_many({
                    "qa_test_token": token
                })
            finally:
                client.close()


if __name__ == "__main__":
    unittest.main()
