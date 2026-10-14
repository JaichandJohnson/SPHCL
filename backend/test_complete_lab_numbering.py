"""Isolated special-dataset record workflow tests. No production credentials allowed."""
import asyncio
import os
import uuid
import unittest
from unittest.mock import AsyncMock, patch

if os.environ.get("DB_NAME") != "mds_lims_test":
    raise RuntimeError("Refusing to run outside mds_lims_test")
if not os.environ.get("MONGO_URL", "").startswith("mongodb+srv://mds_restore_test:"):
    raise RuntimeError("Restricted mds_restore_test credentials required")
if os.environ.get("ENABLE_GOOGLE_DRIVE_BACKUP", "").lower() != "false":
    raise RuntimeError("Backups must be disabled for these tests")

import server

CASES = {
    "mr_surveillance": ("Serum", "Urine", "WM S", "WM U"),
    "pertussis": ("Serum", "Nasopharyngeal Swab", "WP S", "WP NP"),
    "rabies": ("CSF", "Serum", "RC", "RSR"),
}


class SpecialDatasetWorkflowTests(unittest.TestCase):
    async def prepare(self):
        self.created_ids = []
        self.sequence = 800000000 + uuid.uuid4().int % 10000000
        self.year = 2026
        self.allocations = 0

        async def allocate(key):
            self.allocations += 1
            value = self.sequence + self.allocations
            return value, self.year, {"mr_surveillance": "MR", "pertussis": "WP", "rabies": "R"}[key]

        async def dataset(key):
            if key not in CASES:
                raise AssertionError(f"Unexpected dataset: {key}")
            return {"key": key, "name": key, "prefix": {"mr_surveillance": "MR", "pertussis": "WP", "rabies": "R"}[key], "sample_mappings": []}

        self.patches = [
            patch.object(server, "allocate_dataset_sequence", side_effect=allocate),
            patch.object(server, "get_dataset", side_effect=dataset),
            patch.object(server, "generate_patient_id", new_callable=AsyncMock, return_value=f"QA-{uuid.uuid4().hex}"),
        ]
        for p in self.patches:
            p.start()

    async def cleanup(self):
        try:
            if self.created_ids:
                await server.db.records.delete_many({"id": {"$in": self.created_ids}})
        finally:
            for p in reversed(self.patches):
                p.stop()

    @staticmethod
    def sample(dataset, kind, manual=None):
        return {
            "dataset": dataset,
            "sample_type": kind,
            "lab_number": manual,
            "sample_quality": "Good",
            "transport_condition": "Good",
            "tests": [{"test": "QA Numbering Test"}],
        }

    async def create(self, dataset, kinds, manual=None):
        payload = server.LabRecordCreate(
            dataset=dataset, date="2026-10-14", name="QA_NUMBERING_TEMP",
            samples=[self.sample(dataset, kind, manual) for kind in kinds],
        )
        result = await server.create_record(payload, user={"user_id": "qa_numbering_test"})
        self.created_ids.append(result.id)
        return result

    async def check_create_edit_add_sample_and_manual_override(self):
        for dataset, (first, second, prefix1, prefix2) in CASES.items():
            with self.subTest(dataset=dataset):
                before = self.allocations
                record = await self.create(dataset, [first], manual="FORGED 1/26")
                self.assertEqual(self.allocations, before + 1)
                old = record.samples[0]
                self.assertTrue(old.lab_number.startswith(prefix1 + " "))
                self.assertNotEqual(old.lab_number, "FORGED 1/26")
                original_number = old.lab_number
                original_seq = getattr(record, {"mr_surveillance": "mr_patient_number", "pertussis": "pertussis_patient_number", "rabies": "rabies_patient_number"}[dataset])

                existing = old.model_dump()
                existing["lab_number"] = "FORGED EDIT/26"
                new = self.sample(dataset, second, "FORGED NEW/26")
                update = server.LabRecordUpdate(samples=[existing, new], lab_number="FORGED TOP/26")
                edited = await server.update_record(record.id, update, user={"user_id": "qa_numbering_test"})
                self.assertEqual(self.allocations, before + 1, "Editing must not allocate another patient sequence")
                self.assertEqual(edited["samples"][0]["lab_number"], original_number)
                self.assertTrue(edited["samples"][1]["lab_number"].startswith(prefix2 + " "))
                self.assertNotEqual(edited["samples"][1]["lab_number"], "FORGED NEW/26")
                self.assertEqual(edited["lab_number"], original_number)
                new_number = edited["samples"][1]["lab_number"]
                expected_suffix = f"{original_seq:03d}/26" if dataset == "rabies" else f"{original_seq}/26"
                self.assertTrue(new_number.endswith(expected_suffix), (dataset, new_number, expected_suffix))

                # A second edit should not alter either existing number.
                again = await server.update_record(
                    record.id, server.LabRecordUpdate(samples=edited["samples"]),
                    user={"user_id": "qa_numbering_test"},
                )
                self.assertEqual([s["lab_number"] for s in again["samples"]], [original_number, new_number])
                self.assertEqual(self.allocations, before + 1)

    async def check_2027_rollover_format_and_dataset_isolation(self):
        self.year = 2027
        for dataset, (first, _, prefix, _) in CASES.items():
            with self.subTest(dataset=dataset):
                record = await self.create(dataset, [first])
                number = record.samples[0].lab_number
                self.assertTrue(number.startswith(prefix + " "), number)
                self.assertTrue(number.endswith("/27"), number)
                self.assertEqual(getattr(record, {"mr_surveillance": "mr_sequence_year", "pertussis": "pertussis_sequence_year", "rabies": "rabies_sequence_year"}[dataset]), 2027)

    async def check_simultaneous_special_dataset_creations(self):
        for dataset, (first, _, _, _) in CASES.items():
            with self.subTest(dataset=dataset):
                created = await asyncio.gather(*(self.create(dataset, [first]) for _ in range(20)))
                numbers = [r.samples[0].lab_number for r in created]
                self.assertEqual(len(numbers), len(set(numbers)), f"Duplicate numbers in {dataset}")


    def test_complete_special_dataset_workflows(self):
        # Motor's shared client must not be reused across closed event loops.
        asyncio.run(self.run_all_checks())

    async def run_all_checks(self):
        await self.prepare()
        try:
            await self.check_create_edit_add_sample_and_manual_override()
            await self.check_2027_rollover_format_and_dataset_isolation()
            await self.check_simultaneous_special_dataset_creations()
        finally:
            await self.cleanup()


if __name__ == "__main__":
    unittest.main()
