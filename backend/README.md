# Predefined patient profiles

CaseCoach's first backend feature contains exactly two predefined patients from
`faculty-provided-sample-patient-details.csv`. Customization is future work.
AWS session logging and faculty review are implemented separately in
`app/sessions.py` and `app/session_api.py`. Deployment is pending AWS/sign-in
configuration; see `docs/aws-sessions.md`. AI conversation and voice engines are
owned by separate integrations.

Chart preparation and validation are available in `app/chart.py`. The frontend
handoff is documented in `docs/chart-integration.md`, with TypeScript types in
`docs/chart-contract.ts` and initial/post-disclosure JSON fixtures in `docs/examples/`.
Chart values are projected from profile facts rather than maintained separately.

| Patient | Source details | Source personality |
| --- | --- | --- |
| Wyatt Nelson, 18 | High school student; BMI 32; dyslipidemia, total cholesterol 235 and LDL 145; constipation; dislikes fruits and vegetables | Shy, resistant, sensitive |
| Yvette Armstrong, 64 | Full-time state employee with an associate's degree in political science; supplied Stage II hypertension label, BP 155/110 mmHg; BMI 34; difficulty understanding medical explanations and sodium versus salt | Curious, earnest, overwhelmed |

The CSV does not supply lipid units, medication lists, numeric sodium targets,
or detailed symptom histories. Missing values remain unknown. Neither patient is
assigned the earlier generic medical-skepticism preset. Wyatt's reluctance to
discuss constipation is preserved rather than replaced with an openly sharing trait.

Original UUIDs are the lookup keys; readable slugs are also available in the full
profile. All source fields, including literal quotes and the source's misspelled
`race/ethinicity` header, are preserved in `source_record`. Normalized identity
fields use `race_ethnicity`. Demographics must not determine conversational behavior.

Portraits retain the supplied `s3://ru-shp-vhs-bucket/...` references with initials
fallbacks. These are references, not browser-ready image URLs; future authorized
backend code can resolve them to accessible URLs. Image existence/access has not
been checked.

## Run

The profile/chart modules use Python 3.10+ without third-party packages. The AWS
modules require Boto3; AWS tests require the development dependencies. From `backend/`:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
python3 -c 'from app.profiles import list_patient_cards; import json; print(json.dumps(list_patient_cards(), indent=2))'
```

Rebuild the two JSON profiles from the supplied CSV:

```sh
python3 scripts/import_sample_profiles.py '/path/to/faculty-provided-sample-patient-details.csv'
```

The importer selects only Wyatt and Yvette, rejects missing/duplicate selected
rows, and preserves their original records. Its fact mappings apply to these
specific source notes; changed notes require a mapping review rather than silently
using old clinical values. `--output-directory` can target a scratch directory.
The original CSV is not required at runtime; each JSON contains its source row.

## Backend functions

- `list_patient_cards()`: summaries for the student library.
- `get_patient_card(profile_id)`: one summary; missing ids raise `KeyError`.
- `load_patient_profile(profile_id)`: full server-only case. Never return it
  directly to a student client: it includes unreleased facts and teaching rules.
- `validate_profile(profile)`: structural validation, not clinical approval.

For example:

```python
from app.profiles import load_patient_profile

wyatt = load_patient_profile("4d619156-3250-4212-8399-129f3280fab1")
yvette = load_patient_profile("6ca4cbf9-14ef-427c-b87c-bc9d34ce02b8")
```

The catalog finds `data/profiles/*.json` relative to the module, independently of
the working directory. Each read returns fresh data. Future API handlers can map
`KeyError` to 404. Future encounters should pin the profile id/version and enforce
disclosure server-side: metadata alone does not release facts or generate responses.

## Source versus simulation choices

Patient identity, clinical facts, personality, and portrait references come from
the supplied CSV. Opening statements, question topics, fact visibility, response
rules, and learning objectives are authored adaptations of those notes. They are
not transcripts, validated behavioral predictions, or new medical evidence.
The source row preserves Yvette's irregular quotation formatting verbatim.

Profiles record `faculty_provided_sample` provenance and `not_reviewed` status:
we have not independently clinically reviewed the imported cases or asserted that
the original examples represent real people. No MIMIC, HINTS, or Synthea data is
used. Numeric educational targets need a separately reviewed reference before
being added to an encounter's knowledge base.

## Later customization

The encounter contract remains data-driven: identity/avatar, behavior, clinical
facts, unknowns, conversation rules, sources, and objectives are separate fields.
Later customization can derive a new versioned case without overwriting these
defaults. Validation, persistence, and creation routes will be separate work.
