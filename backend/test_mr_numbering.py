
import os
import unittest

if os.environ.get("DB_NAME") != "mds_lims_test":
    raise RuntimeError("Test database required")

if not os.environ.get("MONGO_URL", "").startswith(
    "mongodb+srv://mds_restore_test:"
):
    raise RuntimeError("Restricted test user required")

import server


class MRNumberingTests(unittest.TestCase):

    def test_multiple_samples_same_patient(self):
        samples = [
            {"dataset": "mr_surveillance", "sample_type": "Serum"},
            {"dataset": "mr_surveillance", "sample_type": "Urine"},
            {"dataset": "mr_surveillance", "sample_type": "Throat Swab"},
        ]

        server.assign_mr_lab_numbers(
            samples,
            sequence=25,
            year=2026
        )

        self.assertEqual(
            [sample["lab_number"] for sample in samples],
            [
                "WM S 25/26",
                "WM U 25/26",
                "WM T 25/26",
            ]
        )

    def test_year_transition_format(self):
        samples = [
            {"dataset": "mr_surveillance", "sample_type": "Serum"},
            {"dataset": "mr_surveillance", "sample_type": "Urine"},
        ]

        server.assign_mr_lab_numbers(
            samples,
            sequence=1,
            year=2027
        )

        self.assertEqual(
            samples[0]["lab_number"],
            "WM S 1/27"
        )
        self.assertEqual(
            samples[1]["lab_number"],
            "WM U 1/27"
        )


if __name__ == "__main__":
    unittest.main()
