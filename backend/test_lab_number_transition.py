
import asyncio
import os
import unittest
from unittest.mock import patch

# Prevent accidental use of production database settings.
os.environ["MONGO_URL"] = "mongodb://127.0.0.1:27017"
os.environ["DB_NAME"] = "lab_number_unit_test"

import server


class FakeDatasets:
    def __init__(self):
        self.data = {
            "key": "routine",
            "prefix": "MDS",
            "next_number": 50,
            "sequence_year": 2026,
        }
        self.lock = asyncio.Lock()

    async def update_one(self, query, update):
        async with self.lock:
            expected = query.get("sequence_year")
            current = self.data.get("sequence_year")

            if isinstance(expected, dict):
                matches = "$exists" in expected and (
                    ("sequence_year" in self.data) == expected["$exists"]
                )
            else:
                matches = expected == current

            if not matches:
                return type("Result", (), {"modified_count": 0})()

            self.data.update(update.get("$set", {}))
            return type("Result", (), {"modified_count": 1})()

    async def find_one_and_update(self, query, update, **kwargs):
        async with self.lock:
            if query.get("sequence_year") != self.data.get("sequence_year"):
                return None
            self.data["next_number"] += update["$inc"]["next_number"]
            return self.data.copy()


class LabNumberTests(unittest.IsolatedAsyncioTestCase):

    async def asyncSetUp(self):
        self.fake = FakeDatasets()

        async def fake_get_dataset(key):
            return self.fake.data.copy()

        self.patches = [
            patch.object(server, "get_dataset", fake_get_dataset),
            patch.object(server.db, "datasets", self.fake),
            patch.object(server, "lab_year", return_value=2026),
        ]
        for item in self.patches:
            item.start()

    async def asyncTearDown(self):
        for item in reversed(self.patches):
            item.stop()

    async def test_01_existing_sequence(self):
        number = await server.generate_lab_number("routine")
        self.assertEqual(number, "MDS 50/26")

    async def test_02_concurrent_uniqueness(self):
        numbers = await asyncio.gather(*[
            server.generate_lab_number("routine")
            for _ in range(100)
        ])
        self.assertEqual(len(numbers), len(set(numbers)))
        self.assertEqual(len(numbers), 100)

    async def test_03_year_transition(self):
        with patch.object(server, "lab_year", return_value=2027):
            first = await server.generate_lab_number("routine")
            second = await server.generate_lab_number("routine")

        self.assertEqual(first, "MDS 1/27")
        self.assertEqual(second, "MDS 2/27")

    async def test_04_concurrent_year_transition(self):
        with patch.object(server, "lab_year", return_value=2027):
            numbers = await asyncio.gather(*[
                server.generate_lab_number("routine")
                for _ in range(100)
            ])

        self.assertEqual(len(set(numbers)), 100)
        self.assertEqual("MDS 1/27" in numbers, True)
        self.assertEqual("MDS 100/27" in numbers, True)


if __name__ == "__main__":
    unittest.main()
