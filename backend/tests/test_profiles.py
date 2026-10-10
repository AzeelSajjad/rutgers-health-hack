import unittest
from unittest.mock import patch

from app.profiles import (
    ProfileValidationError,
    get_patient_card,
    list_patient_cards,
    load_patient_profile,
    validate_profile,
)


WYATT_ID = "4d619156-3250-4212-8399-129f3280fab1"
YVETTE_ID = "6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8"


class ProfileTests(unittest.TestCase):
    def test_library_cards_do_not_expose_hidden_case_content(self):
        cards = list_patient_cards()
        self.assertEqual(len(cards), 2)
        self.assertEqual({card["id"] for card in cards}, {WYATT_ID, YVETTE_ID})
        for card in cards:
            for key in ("facts", "behavior", "conversation_rules", "learning_objectives", "source_record"):
                self.assertNotIn(key, card)

    def test_mutation_does_not_change_later_reads(self):
        card = get_patient_card(WYATT_ID)
        card["identity"]["name"] = "Changed"
        profile = load_patient_profile(WYATT_ID)
        profile["facts"].clear()
        fresh = load_patient_profile(WYATT_ID)
        self.assertEqual(fresh["identity"]["name"], "Wyatt Nelson")
        self.assertTrue(fresh["facts"])

    def test_unknown_profile_is_not_silently_replaced(self):
        with self.assertRaises(KeyError):
            load_patient_profile("missing-patient")

    def test_invalid_fact_source_and_duplicate_ids_are_rejected(self):
        for change in ("unknown_source", "duplicate_id"):
            with self.subTest(change=change):
                profile = load_patient_profile(WYATT_ID)
                if change == "unknown_source":
                    profile["facts"][0]["source_id"] = "missing"
                else:
                    profile["facts"][1]["id"] = profile["facts"][0]["id"]
                with self.assertRaises(ProfileValidationError):
                    validate_profile(profile)

    def test_incomplete_or_unsupported_profiles_are_rejected(self):
        for key, value in (("behavior", {}), ("facts", []), ("schema_version", 2),
                           ("identity", {"name": "Test", "age": True})):
            with self.subTest(key=key):
                profile = load_patient_profile(WYATT_ID)
                profile[key] = value
                with self.assertRaises(ProfileValidationError):
                    validate_profile(profile)

    def test_new_case_uses_same_catalog_without_patient_specific_code(self):
        import json
        import tempfile
        from pathlib import Path

        profile = load_patient_profile(WYATT_ID)
        profile["id"] = "second-case"
        profile["source_record"]["patient-uuid"] = "second-case"
        profile["identity"]["name"] = "Another Patient"
        profile["source_record"]["patient-name"] = "Another Patient"
        with tempfile.TemporaryDirectory() as directory:
            Path(directory, "case.json").write_text(json.dumps(profile), encoding="utf-8")
            with patch("app.profiles.PROFILE_DIRECTORY", Path(directory)):
                self.assertEqual(get_patient_card("second-case")["identity"]["name"],
                                 "Another Patient")

    def test_source_identity_and_images_are_preserved(self):
        for profile_id in (WYATT_ID, YVETTE_ID):
            with self.subTest(profile_id=profile_id):
                profile = load_patient_profile(profile_id)
                row = profile["source_record"]
                self.assertEqual(profile["id"], row["patient-uuid"])
                self.assertEqual(profile["identity"]["name"], row["patient-name"])
                self.assertEqual(profile["identity"]["age"], int(row["age"]))
                self.assertEqual(profile["identity"]["avatar"]["uri"], row["patient-img"])
                self.assertEqual(profile["behavior"]["personality"], row["personality"].strip('"'))

    def test_cases_preserve_distinct_disclosure_and_missing_values(self):
        wyatt = load_patient_profile(WYATT_ID)
        yvette = load_patient_profile(YVETTE_ID)
        facts = {fact["id"]: fact for fact in wyatt["facts"]}
        self.assertEqual(facts["constipation"]["visibility"], "on_question")
        self.assertEqual(facts["bmi"]["measurement"]["value"], 32)
        self.assertIsNone(facts["ldl"]["measurement"]["unit"])
        self.assertEqual(facts["ldl"]["measurement"]["value"], 145)
        self.assertEqual(facts["total-cholesterol"]["measurement"]["value"], 235)
        facts = {fact["id"]: fact for fact in yvette["facts"]}
        self.assertEqual(facts["blood-pressure"]["measurement"],
                         {"systolic": 155, "diastolic": 110, "unit": "mmHg"})
        self.assertEqual(facts["bmi"]["measurement"]["value"], 34)
        self.assertIn("Stage II", facts["hypertension"]["text"])

    def test_import_reproduces_cases_and_rejects_unreviewed_source_changes(self):
        from scripts.import_sample_profiles import build_profile
        for profile_id in (WYATT_ID, YVETTE_ID):
            original = load_patient_profile(profile_id)
            self.assertEqual(build_profile(original["source_record"]), original)
            changed = dict(original["source_record"])
            changed["notes"] = "Different medical facts"
            with self.assertRaises(ValueError):
                build_profile(changed)


if __name__ == "__main__":
    unittest.main()
