# Chart integration contract v1

Use `chart-contract.ts` for the frontend response types and `examples/` for JSON
fixtures. These represent the implemented Python projection, not deployed HTTP
endpoints. No voice, question classification, session storage, or UI is included.

## Backend handoff

```python
from app.profiles import load_patient_profile
from app.chart import build_chart_response

profile = load_patient_profile("4d619156-3250-4212-8399-129f3280fab1")
initial_chart = build_chart_response(profile)
# After the encounter service authorizes/discloses a fact in its session state:
updated_chart = build_chart_response(profile, released_fact_ids=["constipation"])
```

Use the session's pinned profile version. The function includes initial items plus
the explicitly released facts. Repeated ids do not duplicate items; unknown ids
raise `ChartValidationError`. An authorized fact that has no chart metadata is
valid but adds no chart item. Each call is a projection, not saved session state.

`prepare_chart_items(profile)` returns the full validated server-only catalog,
including `visibility` and `topics`. Do not expose it to the frontend. The encounter
service must own authorization and released ids; never accept them directly from
a student's request body. It must pass the accumulated released ids on every call.
This module does not infer which student question earns a disclosure.

## Frontend handoff

| Field | Meaning |
| --- | --- |
| `schema_version` | Contract version, currently `1` |
| `patient_id` | Original CSV patient UUID |
| `patient_version` | Profile revision used by the session |
| `items` | Complete currently visible chart snapshot |
| `item_id` | Stable fact id within that patient |
| `label` | Human-readable chart heading |
| `category` | `vitals`, `labs`, `history`, `nutrition`, or `communication` |
| `value_type` | Discriminator: `number`, `blood_pressure`, or `text` |
| `value` | Number, systolic/diastolic object, or source-backed text |
| `display_value` | Ready-to-render value without the unit |
| `unit` | Supplied/normalized unit, or `null` when unavailable/non-applicable |
| `source_reference` | Filename, patient UUID, source id, and source field |

Render `display_value`, appending `unit` once if it is non-null. For numeric values
with a null unit, show “unit not supplied”; do not infer mg/dL for the cholesterol
results. BMI uses the standard normalized `kg/m^2` unit; the raw CSV gives only BMI
values. Source notes and clinical classifications otherwise remain as supplied.
Text items have `unit: null` without needing a missing-unit warning.

Group by `category` using the frontend's chosen layout, preserving item order within
each group. Key rows by `item_id` inside the active patient's chart. Replace the
visible chart with each new snapshot rather than blindly appending rows. Check
patient id/version against the active encounter to avoid mixing charts. A session
wrapper should carry `session_id` for routing/stale-response handling; it is owned
by the encounter backend and not invented by the profile projection.

The payload intentionally excludes hidden item lists, disclosure topics, response
instructions, learning objectives, and the complete source row. Unknown medications,
allergies, dates, symptoms, and clinical targets are not manufactured as chart items.
Absence of an item does not mean a negative or normal finding. No alert severity,
reference ranges, or new treatment recommendations are computed here.

## Current content

- Wyatt: four initial items (BMI, dyslipidemia, total cholesterol, LDL). Bowel health
  and food preferences are question-dependent.
- Yvette: three initial items (hypertension, blood pressure, BMI). Understanding of
  medical explanations and sodium versus salt are question-dependent.

These visibility choices are authored simulation design, not instructions contained
in the CSV. Patient personalities and clinical values remain sourced from that CSV.

## Validation

Profile checks validate unique fact ids and source ids, source references, and
visibility. Chart preparation checks labels, categories, existing source fields,
supported measurement shapes, finite numeric values, and explicit units/nulls.
The chart derives its values directly from those facts so a second clinical value
store cannot drift from the profile. Structural validation is not clinical review.

Run from `backend/`: `python3 -m unittest discover -s tests -v`.
