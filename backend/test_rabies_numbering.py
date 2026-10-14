
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


class RabiesNumberingTests(unittest.TestCase):

    def test_multiple_samples_same_patient(self):
        samples = [
            {"dataset": "rabies", "sample_type": "CSF"},
            {"dataset": "rabies", "sample_type": "Brain"},
            {"dataset": "rabies", "sample_type": "Saliva"},
            {"dataset": "rabies", "sample_type": "Serum"},
        ]

        server.assign_rabies_lab_numbers(
            samples,
            sequence=25,
            year=2026
        )

        self.assertEqual(
            [sample["lab_number"] for sample in samples],
            [
                "RC 025/26",
                "RB 025/26",
                "RS 025/26",
                "RSR 025/26",
            ]
        )

    def test_year_transition_format(self):
        samples = [
            {"dataset": "rabies", "sample_type": "CSF"},
            {"dataset": "rabies", "sample_type": "Brain"},
        ]

        server.assign_rabies_lab_numbers(
            samples,
            sequence=1,
            year=2027
        )

        self.assertEqual(
            samples[0]["lab_number"],
            "RC 001/27"
        )
        self.assertEqual(
            samples[1]["lab_number"],
            "RB 001/27"
        )

    def test_all_supported_specimen_types(self):
        specimen_codes = {
            "CSF": "RC",
            "Brain": "RB",
            "Nuchal Biopsy": "RT",
            "Saliva": "RS",
            "Conjunctival Swab": "RCS",
            "Corneal Swab": "RCS",
            "Plasma": "RP",
            "Serum": "RSR",
        }

        for sample_type, prefix in specimen_codes.items():
            with self.subTest(sample_type=sample_type):
                samples = [{
                    "dataset": "rabies",
                    "sample_type": sample_type
                }]

                server.assign_rabies_lab_numbers(
                    samples,
                    sequence=12,
                    year=2026
                )

                self.assertEqual(
                    samples[0]["lab_number"],
                    f"{prefix} 012/26"
                )

    def test_invalid_sample_type(self):
        samples = [{
            "dataset": "rabies",
            "sample_type": "Urine"
        }]

        with self.assertRaises(server.HTTPException) as context:
            server.assign_rabies_lab_numbers(
                samples,
                sequence=1,
                year=2026
            )

        self.assertEqual(
            context.exception.status_code,
            400
        )


if __name__ == "__main__":
    unittest.main()
