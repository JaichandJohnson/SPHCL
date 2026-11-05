import unittest

from backend.sync_outbox import new_outbox_event, record_change_with_outbox, SyncPreconditionError


class OutboxValidationTests(unittest.TestCase):
    def test_new_event_is_pending(self):
        event = new_outbox_event(origin_id="local", collection="records", document_id="r1",
                                 operation="upsert", base_revision="v1", revision="v2",
                                 payload={"id": "r1"})
        self.assertEqual(event["status"], "pending")
        self.assertEqual(event["attempts"], 0)

    def test_reject_unknown_collection(self):
        with self.assertRaises(ValueError):
            new_outbox_event(origin_id="local", collection="user_sessions",
                             document_id="r1", operation="delete", base_revision="v1",
                             revision="v2", payload=None)

    def test_delete_cannot_contain_payload(self):
        with self.assertRaises(ValueError):
            new_outbox_event(origin_id="local", collection="records",
                             document_id="r1", operation="delete", base_revision="v1",
                             revision="v2", payload={"id": "r1"})


class OutboxPreconditionTests(unittest.IsolatedAsyncioTestCase):
    async def test_reject_unmigrated_document_before_database_access(self):
        with self.assertRaises(SyncPreconditionError):
            await record_change_with_outbox(
                None, collection="records", document_id="r1",
                expected_revision=None, replacement={"id": "r1"}, origin_id="local"
            )

    async def test_reject_client_sync_metadata(self):
        with self.assertRaises(SyncPreconditionError):
            await record_change_with_outbox(
                None, collection="records", document_id="r1",
                expected_revision="v1", replacement={"id": "r1", "_sync_revision": "evil"},
                origin_id="local"
            )


if __name__ == "__main__":
    unittest.main()
