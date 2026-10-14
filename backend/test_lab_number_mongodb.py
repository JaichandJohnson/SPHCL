
import asyncio
import os
import uuid
import unittest
from unittest.mock import patch

# Safety check BEFORE importing server.py.
if os.environ.get("DB_NAME") != "mds_lims_test":
    raise RuntimeError("Refusing to run outside mds_lims_test")

mongo_url = os.environ.get("MONGO_URL", "")
if not mongo_url.startswith("mongodb+srv://mds_restore_test:"):
    raise RuntimeError("Test MongoDB user is required")

import server


class MongoDBLabNumberTests(unittest.IsolatedAsyncioTestCase):
     async def asyncSetUp(self):
        self.client = server.AsyncIOMotorClient(os.environ["MONGO_URL"])
        self.original_db = server.db
        server.db = self.client["mds_lims_test"]

        self.key = "qa_number_" + uuid.uuid4().hex
        self.prefix = "QATEST"

        await server.db.datasets.insert_one({
            "key": self.key,
            "name": "Temporary QA Number Test",
            "prefix": self.prefix,
            "next_number": 50,
            "sequence_year": 2026,
            "active": True,
        })
   
    async def asyncTearDown(self):
        try:
            await server.db.datasets.delete_one({"key": self.key})
        finally:
            server.db = self.original_db
            self.client.close()

    async def test_existing_sequence_and_uniqueness(self):
        with patch.object(server, "lab_year", return_value=2026):
            numbers = await asyncio.gather(*[
                server.generate_lab_number(self.key)
                for _ in range(100)
            ])

        self.assertEqual(len(numbers), 100)
        self.assertEqual(len(set(numbers)), 100)
        self.assertEqual(
            set(numbers),
            {f"QATEST {n}/26" for n in range(50, 150)}
        )

    async def test_year_transition(self):
        with patch.object(server, "lab_year", return_value=2027):
            numbers = await asyncio.gather(*[
                server.generate_lab_number(self.key)
                for _ in range(100)
            ])

        self.assertEqual(len(numbers), 100)
        self.assertEqual(len(set(numbers)), 100)
        self.assertEqual(
            set(numbers),
            {f"QATEST {n}/27" for n in range(1, 101)}
        )

        dataset = await server.db.datasets.find_one(
            {"key": self.key}
        )
        self.assertEqual(dataset["sequence_year"], 2027)
        self.assertEqual(dataset["next_number"], 101)


if __name__ == "__main__":
    unittest.main()
