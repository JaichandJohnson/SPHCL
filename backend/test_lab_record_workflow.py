import asyncio
import os
import uuid
import unittest
from unittest.mock import patch

# Safety checks before importing the application.
if os.environ.get("DB_NAME") != "mds_lims_test":
    raise RuntimeError("Only mds_lims_test is permitted")

if not os.environ.get("MONGO_URL", "").startswith(
    "mongodb+srv://mds_restore_test:"
):
    raise RuntimeError("Restricted test MongoDB user required")

import server


class LabRecordWorkflowTests(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.client = server.AsyncIOMotorClient(
            os.environ["MONGO_URL"]
        )
        self.original_db = server.db
        server.db = self.client["mds_lims_test"]

        self.key = "qa_record_" + uuid.uuid4().hex
        self.prefix = "QA" + uuid.uuid4().hex[:8].upper()

        await server.db.datasets.insert_one({
            "key": self.key,
            "name": self.key,
            "prefix": self.prefix,
            "next_number": 1,
            "sequence_year": 2026,
            "active": True,
        })

    async def asyncTearDown(self):
        try:
            await server.db.records.delete_many({
                "dataset": self.key,
                "name": "AUTOMATED QA TEST"
            })
            await server.db.datasets.delete_one({
                "key": self.key
            })
        finally:
            server.db = self.original_db
            self.client.close()

    async def test_create_record_ignores_manual_number(self):
        payload = server.LabRecordCreate(
            dataset=self.key,
            lab_number="MANUAL-DUPLICATE",
            date="2026-10-14",
            name="AUTOMATED QA TEST",
            sample_type="Serum",
            test="QA Test"
        )

        with patch.object(server, "lab_year", return_value=2026):
            record = await server.create_record(
                payload,
                user={"user_id": "automated_qa"}
            )

        expected = f"{self.prefix} 1/26"

        self.assertEqual(record.lab_number, expected)
        self.assertNotEqual(
            record.lab_number,
            "MANUAL-DUPLICATE"
        )

        saved = await server.db.records.find_one({
            "id": record.id
        })

        self.assertIsNotNone(saved)
        self.assertEqual(saved["lab_number"], expected)
        self.assertEqual(
            saved["samples"][0]["lab_number"],
            expected
        )

    async def test_edit_cannot_change_lab_number(self):
        # Create a temporary laboratory record.
        create_payload = server.LabRecordCreate(
            dataset=self.key,
            date="2026-10-14",
            name="AUTOMATED QA TEST",
            sample_type="Serum",
            test="QA Test"
        )

        with patch.object(server, "lab_year", return_value=2026):
            record = await server.create_record(
                create_payload,
                user={"user_id": "automated_qa"}
            )

        original_number = record.lab_number

        # Attempt to change the laboratory number.
        update_payload = server.LabRecordUpdate(
            name="AUTOMATED QA TEST",
            lab_number="INVALID-MANUAL-NUMBER"
        )

        updated = await server.update_record(
            record.id,
            update_payload,
            user={"user_id": "automated_qa"}
        )

        self.assertEqual(
            updated["lab_number"],
            original_number
        )

        # Verify that MongoDB still stores the original number.
        saved = await server.db.records.find_one({
            "id": record.id
        })

        self.assertEqual(
            saved["lab_number"],
            original_number
        )

    async def test_concurrent_record_creation(self):
        # Create 100 laboratory records simultaneously.
        async def create_one(index):
            payload = server.LabRecordCreate(
                dataset=self.key,
                date="2026-10-14",
                name="AUTOMATED QA TEST",
                sample_type="Serum",
                test="QA Test"
            )

            return await server.create_record(
                payload,
                user={"user_id": "automated_qa"}
            )

        with patch.object(server, "lab_year", return_value=2026):
            records = await asyncio.gather(*[
                create_one(i) for i in range(100)
            ])

        # Verify 100 records were created.
        self.assertEqual(len(records), 100)

        # Verify all laboratory numbers are unique.
        numbers = [record.lab_number for record in records]

        self.assertEqual(len(set(numbers)), 100)

        # Verify the expected numbering sequence.
        expected = {
            f"{self.prefix} {n}/26"
            for n in range(1, 101)
        }

        self.assertEqual(set(numbers), expected)

        # Verify all records were saved in MongoDB.
        saved_count = await server.db.records.count_documents({
            "dataset": self.key,
            "name": "AUTOMATED QA TEST"
        })

        self.assertEqual(saved_count, 100)


if __name__ == "__main__":
    unittest.main()
