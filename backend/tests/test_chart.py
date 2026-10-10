import unittest

from app.chart import ChartValidationError, build_chart_response, prepare_chart_items
from app.profiles import load_patient_profile

WYATT = "4d619156-3250-4212-8399-129f3280fab1"
YVETTE = "6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8"


class ChartTests(unittest.TestCase):
    def test_initial_chart_contains_only_initial_facts(self):
        for patient_id, count in ((WYATT, 4), (YVETTE, 3)):
            profile = load_patient_profile(patient_id)
            response = build_chart_response(profile)
            self.assertEqual(len(response["items"]), count)
            self.assertEqual(response["patient_id"], patient_id)
            self.assertEqual(response["patient_version"], profile["version"])
            expected = {f["id"] for f in profile["facts"] if f["visibility"] == "initial"}
            self.assertEqual({i["item_id"] for i in response["items"]}, expected)
            self.assertNotIn("source_record", response)
            for item in response["items"]:
                self.assertNotIn("visibility", item)
                self.assertNotIn("topics", item)

    def test_release_is_explicit_and_does_not_duplicate_or_leak_other_items(self):
        profile = load_patient_profile(WYATT)
        response = build_chart_response(profile, ["constipation", "constipation"])
        self.assertEqual(len(response["items"]), 5)
        self.assertNotIn("food-preferences", {i["item_id"] for i in response["items"]})
        self.assertEqual(len(build_chart_response(profile)["items"]), 4)

    def test_unknown_releases_and_malformed_release_arguments_fail(self):
        for ids in (["nonexistent"], "constipation", [False], None):
            with self.subTest(ids=ids), self.assertRaises(ChartValidationError):
                build_chart_response(load_patient_profile(WYATT), ids)

    def test_values_and_units_are_preserved_without_guessing(self):
        items = {i["item_id"]: i for i in prepare_chart_items(load_patient_profile(WYATT))}
        self.assertEqual(items["total-cholesterol"]["value"], 235)
        self.assertEqual(items["ldl"]["display_value"], "145")
        self.assertIsNone(items["ldl"]["unit"])
        items = {i["item_id"]: i for i in prepare_chart_items(load_patient_profile(YVETTE))}
        self.assertEqual(items["blood-pressure"]["value"], {"systolic": 155, "diastolic": 110})
        self.assertEqual(items["blood-pressure"]["display_value"], "155/110")
        self.assertEqual(items["blood-pressure"]["unit"], "mmHg")

    def test_invalid_categories_measurements_and_source_fields_fail(self):
        for change in ("category", "boolean", "nan", "shape", "source"):
            profile = load_patient_profile(WYATT)
            fact = profile["facts"][0]
            if change == "category":
                fact["chart"]["category"] = "other"
            elif change == "boolean":
                fact["measurement"]["value"] = True
            elif change == "nan":
                fact["measurement"]["value"] = float("nan")
            elif change == "shape":
                fact["measurement"]["unexpected"] = 123
            else:
                fact["source_field"] = "missing-field"
            with self.subTest(change=change), self.assertRaises(ChartValidationError):
                prepare_chart_items(profile)

    def test_projection_uses_current_fact_and_does_not_mutate_profile(self):
        profile = load_patient_profile(WYATT)
        profile["facts"][0]["measurement"]["value"] = 33
        result = build_chart_response(profile)
        self.assertEqual(result["items"][0]["value"], 33)
        result["items"][0]["source_reference"]["field"] = "changed"
        self.assertEqual(profile["facts"][0]["source_field"], "notes")

    def test_both_profiles_share_identical_item_keys(self):
        keys = None
        for patient_id in (WYATT, YVETTE):
            profile = load_patient_profile(patient_id)
            released = [fact["id"] for fact in profile["facts"]]
            for item in build_chart_response(profile, released)["items"]:
                if keys is None:
                    keys = set(item)
                self.assertEqual(set(item), keys)
                self.assertEqual(item["source_reference"]["patient_uuid"], patient_id)

    def test_frontend_fixtures_match_backend_projection(self):
        import json
        from pathlib import Path
        directory = Path(__file__).resolve().parent.parent / "docs" / "examples"
        for patient_id, slug, released in ((WYATT, "wyatt", ["constipation"]),
                                           (YVETTE, "yvette", ["sodium-confusion"])):
            profile = load_patient_profile(patient_id)
            for label, ids in (("initial", []), ("after-disclosure", released)):
                with self.subTest(patient=slug, label=label):
                    fixture = json.loads((directory / f"{slug}-chart-{label}.json").read_text())
                    self.assertEqual(fixture, build_chart_response(profile, ids))


if __name__ == "__main__":
    unittest.main()
