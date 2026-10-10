"""Prepare chart items from profile facts; the session service owns disclosure."""

from copy import deepcopy
from math import isfinite
from typing import Any, Iterable

from app.profiles import validate_profile


CATEGORIES = {"vitals", "labs", "history", "nutrition", "communication"}


class ChartValidationError(ValueError):
    """Chart data or the session's released-fact ids are invalid."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ChartValidationError(message)


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _number(value: Any) -> bool:
    return type(value) in (int, float) and isfinite(value)


def prepare_chart_items(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Return validated server-only items including visibility/topic metadata.

    Every fact with chart metadata is projected without copying clinical values
    into a separate store. This does not classify questions or unlock anything.
    """
    validate_profile(profile)
    _require(_text(profile["provenance"].get("source_filename")),
             "Chart needs a source filename")
    sources = {source["id"]: source for source in profile["sources"]}
    items = []
    for fact in profile["facts"]:
        if "chart" not in fact:
            continue
        chart = fact["chart"]
        _require(isinstance(chart, dict), "Chart metadata must be an object")
        _require(_text(chart.get("label")), "Chart label must be nonempty")
        _require(_text(chart.get("category")) and chart["category"] in CATEGORIES,
                 "Unknown chart category")
        source = sources[fact["source_id"]]
        _require(source["kind"] == "provided_csv", "Chart facts require CSV provenance")
        source_field = fact.get("source_field")
        _require(_text(source_field) and source_field in profile.get("source_record", {}),
                 "Chart fact must reference an existing CSV field")
        value, unit, value_type = fact["text"], None, "text"
        display_value = value
        if "measurement" in fact:
            measurement = fact["measurement"]
            _require(isinstance(measurement, dict), "Measurement must be an object")
            unit = measurement.get("unit")
            _require("unit" in measurement and (unit is None or _text(unit)),
                     "Measurement unit must be a string or explicit null")
            if set(measurement) == {"value", "unit"}:
                value = measurement["value"]
                _require(_number(value), "Measurement value must be a finite number")
                value_type, display_value = "number", str(value)
            elif set(measurement) == {"systolic", "diastolic", "unit"}:
                _require(all(_number(measurement[key]) for key in ("systolic", "diastolic")),
                         "Blood pressure requires finite systolic and diastolic values")
                _require(unit == "mmHg", "Blood pressure unit must be mmHg")
                value = {key: measurement[key] for key in ("systolic", "diastolic")}
                value_type = "blood_pressure"
                display_value = f"{value['systolic']}/{value['diastolic']}"
            else:
                raise ChartValidationError("Unsupported measurement shape")
        items.append({
            "item_id": fact["id"], "label": chart["label"],
            "category": chart["category"], "value_type": value_type,
            "value": deepcopy(value), "display_value": display_value, "unit": unit,
            "source_reference": {
                "source_id": fact["source_id"],
                "filename": profile["provenance"]["source_filename"],
                "patient_uuid": profile["id"], "field": source_field
            },
            "visibility": fact["visibility"], "topics": list(fact["topics"])
        })
    _require(bool(items), "Profile has no chart items")
    return items


def build_chart_response(
    profile: dict[str, Any], released_fact_ids: Iterable[str] = ()
) -> dict[str, Any]:
    """Project only initial items and facts released by trusted session state.

    Never pass a student's request body directly as released_fact_ids. Session
    authorization, question handling, and persistence belong to the encounter
    service. Pass its pinned profile version, not the latest catalog version.
    """
    _require(not isinstance(released_fact_ids, (str, bytes)),
             "Released ids must be a collection, not a string")
    try:
        released = list(released_fact_ids)
    except TypeError as error:
        raise ChartValidationError("Released ids must be an iterable of strings") from error
    _require(all(_text(item_id) for item_id in released), "Released ids must be strings")
    items = prepare_chart_items(profile)
    known = {fact["id"] for fact in profile["facts"]}
    _require(set(released) <= known, "Released ids include an unknown fact")
    visible = []
    for item in items:
        if item["visibility"] == "initial" or item["item_id"] in released:
            public = {key: deepcopy(value) for key, value in item.items()
                      if key not in ("visibility", "topics")}
            visible.append(public)
    return {"schema_version": 1, "patient_id": profile["id"],
            "patient_version": profile["version"], "items": visible}
