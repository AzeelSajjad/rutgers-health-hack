# Additional practice patients from MIMIC-IV public demo

Wyatt Nelson and Yvette Armstrong remain fixed default/control cases. Additional cases come from the **open-access MIMIC-IV Clinical Database Demo v2.2**, not the credentialed full MIMIC database. This release contains 100 deidentified patients and excludes free-text clinical notes.

Source: https://physionet.org/content/mimic-iv-demo/2.2/
Citation: Johnson, A., Bulgarelli, L., Pollard, T., Horng, S., Celi, L. A., & Mark, R. (2023). MIMIC-IV Clinical Database Demo (version 2.2). PhysioNet. https://doi.org/10.13026/dp1f-ex47
License: Open Data Commons Open Database License v1.0 (ODbL-1.0). The downloaded license and attribution accompany generated cases. If distributing a derived database, retain the attribution and comply with its share-alike requirements. This PR distributes code and fictional test fixtures, not the clinical database.

## Get started

From the repository root:

```sh
npm ci
npm run import:mimic-demo --workspace backend -- --limit 5
npm run dev --workspace backend
```

In another Terminal:

```sh
npm run dev --workspace frontend
```

Open http://localhost:5173. Sign in to the unified CaseCoach frontend. The avatar patient library keeps Wyatt and Yvette and offers Generate random patient. Select it, then Begin conversation. Auth0 remains the entry point; this feature does not replace sign-in routing. For a test without AWS, prefix the backend command with `FAKE_AWS=1`; this mode uses scripted replies and no speech audio. Live AI uses the team's existing AWS setup and credentials.

Downloaded CSVs and generated cases stay in ignored `backend/work/mimic-demo/`. They are not in GitHub. Every teammate/server must run the import once; generation never runs automatically at app startup. The library still works with only defaults if this directory is absent. `--limit` accepts 1–20, with one eligible stay per patient. It can produce fewer when insufficient eligible records exist.

The downloader uses only fixed official public-demo URLs, verifies SHA-256 checksums against the release manifest, and keeps its license locally. It intentionally has no arbitrary full-dataset upload/import option. Credentials are not needed to download this demo.

## How the transformation works

- Joins patients to admissions by subject ID, diagnoses by **both subject and admission ID**, and diagnosis titles by **both ICD code and ICD version**. Codes remain strings to preserve leading zeroes.
- Selects the first eligible completed, non-expired admission per adult. Excludes obscured anchor ages over 89 and stays whose approximate age falls outside 18–89. Age uses `anchor_age + admission_year - anchor_year`; it is approximate rather than a birthday-accurate age. Shifted dates are not presented as actual calendar dates.
- Uses up to three recorded diagnosis titles as hospital-history facts. These are coded diagnoses, not proof of current symptoms, patient awareness, or chief complaint. Unmatched records are skipped; no clinical text is invented to fill gaps.
- Uses invented `Practice Patient NN` names, a hypothetical discussion of a completed hospital record, and explicitly authored neutral/engaged behavior. Names, follow-up framing, style, voice, disclosure and objectives are simulation adaptations, not source testimony or validated behavioral predictions.
- Does not import discharge summaries, invent symptoms, medications, allergies, negative findings, jobs, or preferences. Missing information remains unknown. Does not infer behavior from demographics or diagnosis.
- Cases conform to the existing PatientCase schema and use the existing grounded-reply, disclosure, validation and speech pipeline. Generated cases are labeled **clinical review pending** and are not asserted to be faculty-approved.

## Catalog integration

`GET /api/cases` returns `{cases: [...]}` with only id, name, age, visitReason, origin, clinicalReviewStatus and an optional dataset citation. The route excludes full facts, persona, source subject/admission IDs and teaching rules. Allowed HTTP origins follow `ALLOWED_ORIGINS`.

The main React frontend includes a library; the other frontend can use this endpoint to add cases to its picker. Send the returned `id` in its existing `start_session` message. The same repository resolves both default UUIDs and imported IDs. The older Morgan Lee test case remains resolvable for existing tests but is not shown as a third default.

For local alternate ports, set `ENCOUNTER_BACKEND_URL=http://localhost:3101` before running Vite. This changes both its API and WebSocket proxy targets.

## Restrictions and limits

This implementation only supports the public demo. Do not put credentialed MIMIC records or their restricted derivatives on the public repo or paste them into this chat. Full MIMIC requires credentialing/training and a data use agreement. Cloud LLM use with restricted data requires separately verifying compliant handling; the public-demo importer does not establish that authorization.

PhysioNet guidance: https://physionet.org/news/post/llm-responsible-use/

These are record-grounded practice drafts. They do not reconstruct actual patient conversations, supply a complete medical chart, or establish a validated clinical assessment. More detailed cases require carefully selected timed measurements and clinical review.

## Tests

`npm test --workspace backend` and `npm test --workspace frontend` cover joins, ICD version/leading-zero handling, exclusions, missing fields, deterministic generation, keeping defaults, public projection, origin checks, starting an imported encounter with fake dependencies, library navigation and retry behavior. Live Bedrock/Polly audio is not exercised by the automated tests.

## Random patient option

The library keeps the two defaults and offers **Generate random patient**. POST `/api/cases/random` returns an allowlisted case ID and patient name/age/visit reason, then the avatar screen uses that ID to start an encounter. The endpoint reads the downloaded demo source tables, selects a random eligible record (avoiding the immediately previous record), builds a new case with a unique encounter ID, and returns `{caseId, patient: {name, age, visitReason}}`. No source identifiers or hidden facts are returned to the selection page. The source download is reused; each click does not fetch PhysioNet again.

Generated selection cases are held in backend memory (up to 200). Each started encounter pins its case snapshot in session storage, so eviction of a selection case cannot interrupt an active encounter or resume. In-memory sessions disappear after a restart. This prototype requires the encounter and generation requests to reach the same backend instance. Repeated records can occur across the finite demo cohort. The importer must be run once on each backend deployment; its five prebuilt files are no longer displayed as selection options.
