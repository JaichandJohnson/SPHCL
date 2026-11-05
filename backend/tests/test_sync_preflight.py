import unittest

from backend.sync_preflight import assess_hello


class MongoPreflightTests(unittest.TestCase):
    def test_standalone_is_not_eligible(self):
        report = assess_hello({"isWritablePrimary": True, "logicalSessionTimeoutMinutes": 30, "maxWireVersion": 17})
        self.assertFalse(report["transaction_prerequisites_present"])
        self.assertEqual(report["topology"], "standalone_or_unknown")

    def test_replica_set_with_sessions_is_eligible(self):
        report = assess_hello({"setName": "rs0", "logicalSessionTimeoutMinutes": 30, "maxWireVersion": 17})
        self.assertTrue(report["transaction_prerequisites_present"])

    def test_replica_set_without_sessions_is_not_eligible(self):
        report = assess_hello({"setName": "rs0", "maxWireVersion": 17})
        self.assertFalse(report["transaction_prerequisites_present"])

    def test_mongos_with_sessions_is_eligible(self):
        report = assess_hello({"msg": "isdbgrid", "logicalSessionTimeoutMinutes": 30, "maxWireVersion": 17})
        self.assertTrue(report["transaction_prerequisites_present"])


if __name__ == "__main__":
    unittest.main()
