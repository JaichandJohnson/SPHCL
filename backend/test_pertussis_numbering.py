
import os
import unittest

# Safety checks before importing the application.
if os.environ.get("DB_NAME") != "mds_lims_test":
    raise RuntimeError("Test database required")

if not os.environ.get("MONGO_URL", "").startswith(
    "mongodb+srv://mds_restore_test:"
):
    raise RuntimeError("Restricted test user required")

import server


class PertussisNumberingTests(unittest.TestCase):

    def test_multiple_samples_same_patient(self):
        samples = [
            {
                "dataset": "pertussis",
                "sample_type": "Serum"
            },
            {
                "dataset": "pertussis",
                "sample_type": "Nasopharyngeal Swab"
            },
        ]

        server.assign_pertussis_lab_numbers(
            samples,
            sequence=25,
            master_prefix="WP",
            year=2026
        )

        self.assertEqual(
            [sample["lab_number"] for sample in samples],
            [
                "WP S 25/26",
                "WP NP 25/26",
            ]
        )

    def test_year_transition_format(self):
        samples = [
            {
                "dataset": "pertussis",
                "sample_type": "Serum"
            },
            {
                "dataset": "pertussis",
                "sample_type": "Nasopharyngeal Swab"
            },
        ]

        server.assign_pertussis_lab_numbers(
            samples,
            sequence=1,
            master_prefix="WP",
            year=2027
        )

        self.assertEqual(
            samples[0]["lab_number"],
            "WP S 1/27"
        )

        self.assertEqual(
            samples[1]["lab_number"],
            "WP NP 1/27"
        )

    def test_invalid_sample_type(self):
        samples = [
            {
                "dataset": "pertussis",
                "sample_type": "Urine"
            }
        ]

        with self.assertRaises(server.HTTPException) as context:
            server.assign_pertussis_lab_numbers(
                samples,
                sequence=1,
                master_prefix="WP",
                year=2026
            )

        self.assertEqual(
            context.exception.status_code,
            400
        )


if __name__ == "__main__":
    unittest.main()
