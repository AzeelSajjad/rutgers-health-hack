"""Build the two selected cases from the supplied CSV, preserving source rows.

Communication rules, opening statements, objectives, and disclosure choices are
explicit authored adaptations. Clinical values come from the supplied notes.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
from app.profiles import validate_profile


SELECTED_NAMES = ("Wyatt Nelson", "Yvette Armstrong")
CHART_METADATA = {
    "bmi": {"label": "BMI", "category": "vitals"},
    "dyslipidemia": {"label": "Dyslipidemia", "category": "history"},
    "total-cholesterol": {"label": "Total cholesterol", "category": "labs"},
    "ldl": {"label": "LDL cholesterol", "category": "labs"},
    "constipation": {"label": "Bowel health", "category": "history"},
    "food-preferences": {"label": "Food preferences", "category": "nutrition"},
    "hypertension": {"label": "Hypertension", "category": "history"},
    "blood-pressure": {"label": "Blood pressure", "category": "vitals"},
    "medical-explanations": {"label": "Understanding medical explanations", "category": "communication"},
    "sodium-confusion": {"label": "Sodium and salt understanding", "category": "nutrition"}
}
REVIEWED_NOTES = {
    "Wyatt Nelson": 'Wyatt has a BMI of 32 and dyslipidemia (Total Chol 235, LDL 145). He struggles with constipation but avoids talking about it.  He dislikes fruits and vegetables and needs developmentally appropriate counseling around fiber, fat intake, bowel health, and cardiovascular risk.',
    "Yvette Armstrong": 'Recently diagnosed with Stage II hypertension (BP 155/110 mmHg), Yvette struggles to understand medical explanations and is confused about sodium and salt. BMI is 34. “My doctor told me, but I just didn’t understand what she said. She needs clear education on what hypertension is, the role of sodium in blood pressure control, sodium limits, and the benefits of modest weight loss.'
}
COMMON_RULES = [
    "Use only the supplied facts for patient-specific clinical statements. Missing information is unknown, not normal or absent.",
    "Do not invent medications, doses, symptoms, history, lab units, or treatment targets.",
    "Clinical facts stay fixed throughout an encounter. Appearance and demographic background do not determine behavior.",
    "Opening statements and conversational responses are authored simulation adaptations, not source quotations unless explicitly identified."
]
DESIGNS = {
    "Wyatt Nelson": {
        "slug": "wyatt-nelson",
        "opening_statement": "Talking about my eating habits is kind of awkward. Can we take it one question at a time?",
        "openness": "Reserved; the source says he avoids talking about constipation. Do not apply the earlier openly sharing preset.",
        "response_style": "Shy, resistant, and sensitive, as supplied. Keep responses brief and age appropriate without caricature.",
        "rules": [
            "Do not volunteer constipation at the opening. When asked a relevant bowel-health question gently, disclose the supplied constipation fact without inventing frequency or duration.",
            "Respond cautiously to dietary questions. Acknowledge respectful explanations without automatically changing preferences."
        ],
        "objectives": [
            "Explore food preferences and bowel concerns using nonjudgmental, developmentally appropriate questions.",
            "Explain the role of fiber and discuss fat intake in plain language.",
            "Connect the supplied clinical information to bowel health and cardiovascular risk without inventing clinical details."
        ],
        "facts": [
            ("bmi", "Wyatt has a BMI of 32.", "initial", ["body_measurements"], {"value": 32, "unit": "kg/m^2"}),
            ("dyslipidemia", "Wyatt has dyslipidemia.", "initial", ["medical_history"], None),
            ("total-cholesterol", "Total cholesterol is 235; the CSV does not specify a unit.", "initial", ["lipids", "laboratory_results"], {"value": 235, "unit": None}),
            ("ldl", "LDL is 145; the CSV does not specify a unit.", "initial", ["lipids", "laboratory_results"], {"value": 145, "unit": None}),
            ("constipation", "Wyatt struggles with constipation and avoids talking about it.", "on_question", ["bowel_health", "symptoms"], None),
            ("food-preferences", "Wyatt dislikes fruits and vegetables.", "on_question", ["diet", "food_preferences"], None)
        ],
        "unknowns": ["Constipation duration, frequency, severity, and associated symptoms", "Medication list, allergies, and family history", "Diet quantities, height, weight, and laboratory units"]
    },
    "Yvette Armstrong": {
        "slug": "yvette-armstrong",
        "opening_statement": "My doctor told me about my blood pressure, but I didn't understand the explanation. I'm confused about sodium and salt.",
        "openness": "Curious and earnest, as supplied; asks for clarification. The source does not establish broader disclosure behavior.",
        "response_style": "Curious, earnest, and overwhelmed, as supplied. Use everyday language and focused clarification questions.",
        "rules": [
            "Ask for clarification about sodium versus salt when relevant. Do not portray confusion as low intelligence or infer it from education or ethnicity.",
            "If an explanation is jargon-heavy, say it is difficult to follow. Acknowledge a clear explanation without claiming instant mastery or treatment agreement.",
            "Preserve the supplied Stage II hypertension label and BP 155/110 mmHg. Do not reinterpret the classification or invent repeat measurements."
        ],
        "objectives": [
            "Explain hypertension in plain language and check understanding.",
            "Clarify sodium versus salt and discuss sodium's role in blood pressure control.",
            "Discuss sodium limits using an appropriate reviewed reference; this CSV does not supply a numeric target.",
            "Discuss the benefits of modest weight loss respectfully, without inventing a numeric goal."
        ],
        "facts": [
            ("hypertension", "Yvette was recently diagnosed with Stage II hypertension, as stated in the CSV.", "initial", ["medical_history", "reason_for_visit"], None),
            ("blood-pressure", "The supplied blood pressure is 155/110 mmHg.", "initial", ["blood_pressure", "vitals"], {"systolic": 155, "diastolic": 110, "unit": "mmHg"}),
            ("bmi", "Yvette has a BMI of 34.", "initial", ["body_measurements"], {"value": 34, "unit": "kg/m^2"}),
            ("medical-explanations", "Yvette struggles to understand medical explanations.", "on_question", ["understanding", "communication_preferences"], None),
            ("sodium-confusion", "Yvette is confused about sodium and salt.", "on_question", ["diet", "sodium", "understanding"], None)
        ],
        "unknowns": ["Current symptoms, repeat blood pressure readings, and diagnosis date", "Medication list, allergies, and other medical conditions", "Current sodium intake, numeric sodium limit, and weight-loss target"]
    }
}


def clean(value: str) -> str:
    """Remove CSV fields' literal wrapping quotes; preserve raw rows separately."""
    return value.strip().strip('"').strip()


def build_profile(row: dict[str, str]) -> dict:
    name = row["patient-name"]
    if clean(row["notes"]) != REVIEWED_NOTES[name]:
        raise ValueError(f"Source notes changed for {name}; review fact mappings before importing")
    design = DESIGNS[name]
    initials = "".join(part[0] for part in name.split())
    profile = {
        "schema_version": 1, "id": row["patient-uuid"], "slug": design["slug"],
        "version": 1, "kind": "predefined",
        "identity": {
            "name": name, "age": int(row["age"]), "background": clean(row["background"]),
            "gender": clean(row["gender"]), "race_ethnicity": clean(row["race/ethinicity"]),
            "avatar": {"type": "s3_reference", "uri": row["patient-img"], "initials": initials}
        },
        "title": clean(row["summary"]), "summary": clean(row["summary"]),
        "opening_statement": design["opening_statement"],
        "behavior": {
            "personality": clean(row["personality"]),
            "trust": "Not specified in the CSV; do not assume medical skepticism or distrust.",
            "openness": design["openness"],
            "treatment_concerns": "No specific medication concerns or treatment refusal are supplied.",
            "response_style": design["response_style"]
        },
        "facts": [], "unknowns": design["unknowns"],
        "conversation_rules": COMMON_RULES + design["rules"],
        "learning_objectives": design["objectives"],
        "source_record": dict(row),
        "sources": [
            {"id": "provided-csv", "kind": "provided_csv", "description": "faculty-provided-sample-patient-details.csv; original row preserved in source_record.", "patient_uuid": row["patient-uuid"]},
            {"id": "simulation-adaptation", "kind": "simulation_design", "description": "Authored opening statement, objectives, topic labels, and disclosure/response rules adapted from the supplied notes and personality; not validated behavioral predictions."}
        ],
        "provenance": {
            "case_origin": "faculty_provided_sample", "clinical_review_status": "not_reviewed",
            "dataset_usage": "Imported from the supplied sample-patient CSV. No MIMIC, HINTS, or Synthea records used. Source data are sample cases; their real/synthetic status is not asserted.",
            "source_filename": "faculty-provided-sample-patient-details.csv"
        }
    }
    for fact_id, text, visibility, topics, measurement in design["facts"]:
        fact = {"id": fact_id, "text": text, "visibility": visibility, "topics": topics, "source_id": "provided-csv", "source_field": "notes", "chart": dict(CHART_METADATA[fact_id])}
        if measurement is not None:
            fact["measurement"] = measurement
        profile["facts"].append(fact)
    validate_profile(profile)
    from app.chart import prepare_chart_items
    prepare_chart_items(profile)
    return profile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv_path", type=Path)
    parser.add_argument("--output-directory", type=Path, default=BACKEND / "data" / "profiles")
    args = parser.parse_args()
    selected = {}
    with args.csv_path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        for row in reader:
            if row.get("patient-name") in SELECTED_NAMES:
                if row["patient-name"] in selected:
                    raise ValueError("Duplicate selected patient in CSV")
                selected[row["patient-name"]] = row
    if set(selected) != set(SELECTED_NAMES):
        raise ValueError("CSV must include both Wyatt Nelson and Yvette Armstrong")
    profiles = [build_profile(selected[name]) for name in SELECTED_NAMES]
    args.output_directory.mkdir(parents=True, exist_ok=True)
    for profile in profiles:
        destination = args.output_directory / (profile["slug"] + ".json")
        destination.write_text(json.dumps(profile, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Built {profile['identity']['name']}: {destination.name}")


if __name__ == "__main__":
    main()
