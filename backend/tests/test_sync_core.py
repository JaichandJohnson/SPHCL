"""Run with: python -m unittest discover -s backend/tests -p 'test_sync_core.py'"""
import unittest
from datetime import datetime, timezone

from sync_core import canonical_digest, classify_incoming, SyncEvent


class SyncCoreTests(unittest.TestCase):
    def test_digest_is_order_independent_and_ignores_mongo_id(self):
        left = {"id": "r1", "samples": [{"lab_number": "WP 1/26"}], "_id": "local"}
        right = {"samples": [{"lab_number": "WP 1/26"}], "_id": "cloud", "id": "r1"}
        self.assertEqual(canonical_digest(left), canonical_digest(right))

    def test_conflicting_update_is_rejected(self):
        self.assertEqual(
            classify_incoming(incoming_event_id="e1", incoming_base_revision="rev-old",
                              incoming_revision="rev-new", current_revision="rev-other",
                              already_applied=False),
            "conflict",
        )

    def test_matching_revision_can_apply(self):
        self.assertEqual(
            classify_incoming(incoming_event_id="e2", incoming_base_revision="rev-old",
                              incoming_revision="rev-new", current_revision="rev-old",
                              already_applied=False),
            "apply",
        )

    def test_retry_is_idempotent(self):
        self.assertEqual(
            classify_incoming(incoming_event_id="e3", incoming_base_revision="rev-old",
                              incoming_revision="rev-new", current_revision="rev-new",
                              already_applied=True),
            "duplicate",
        )

    def test_event_model(self):
        event = SyncEvent(origin_id="local-test", collection="records",
                          document_id="r1", operation="upsert", revision="rev1",
                          payload={"id": "r1"})
        self.assertEqual(event.collection, "records")


if __name__ == "__main__":
    unittest.main()
