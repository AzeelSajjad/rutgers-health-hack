"""Read predefined cases. Full profiles are for backend use only.

Framework-independent functions can be wired to HTTP routes later. There is no
patient creation or customization endpoint in this first version.
"""

import json
from pathlib import Path
from typing import Any


PROFILE_DIRECTORY = Path(__file__).resolve().parent.parent / "data" / "profiles"


class ProfileValidationError(ValueError):
    """A bundled case is incomplete or internally inconsistent."""


def validate_profile(profile: dict[str, Any]) -> None:
    """Check the case contract, not clinical validity."""
    def require(condition: bool, message: str) -> None:
        if not condition:
            raise ProfileValidationError(message)

    def text(value: Any) -> bool:
        return isinstance(value, str) and bool(value.strip())

    require(isinstance(profile, dict), "Profile must be an object")
    require(profile.get("schema_version") == 1, "Unsupported schema_version")
    require(text(profile.get("id")), "Profile needs an id")
    require(type(profile.get("version")) is int and profile["version"] > 0,
            "Profile version must be a positive integer")
    require(profile.get("kind") == "predefined", "Only predefined profiles are supported")
    identity = profile.get("identity")
    require(isinstance(identity, dict), "Profile needs identity")
    require(text(identity.get("name")), "Identity needs a name")
    require(type(identity.get("age")) is int and identity["age"] >= 18,
            "This case library supports adult patients")
    avatar = identity.get("avatar")
    require(isinstance(avatar, dict), "Identity needs avatar metadata")
    require(avatar.get("type") in ("initials", "s3_reference"), "Unsupported avatar type")
    require(text(avatar.get("initials")), "Avatar needs fallback initials")
    if avatar["type"] == "s3_reference":
        uri = avatar.get("uri")
        require(text(uri) and uri.startswith("s3://") and "/" in uri[5:],
                "Avatar needs an S3 image reference")
    for key in ("title", "summary", "opening_statement"):
        require(text(profile.get(key)), f"Profile needs {key}")

    behavior = profile.get("behavior")
    require(isinstance(behavior, dict), "Profile needs behavior")
    for key in ("personality", "trust", "openness", "treatment_concerns", "response_style"):
        require(text(behavior.get(key)), f"Behavior needs {key}")
    for key in ("conversation_rules", "learning_objectives", "unknowns"):
        values = profile.get(key)
        require(isinstance(values, list) and bool(values) and all(text(v) for v in values),
                f"{key} must contain nonempty strings")

    sources = profile.get("sources")
    require(isinstance(sources, list) and bool(sources), "Profile needs sources")
    source_ids = set()
    for source in sources:
        require(isinstance(source, dict), "Source must be an object")
        require(text(source.get("id")) and source["id"] not in source_ids,
                "Source ids must be nonempty and unique")
        require(source.get("kind") in ("simulation_design", "research_reference", "provided_csv"),
                "Unsupported source kind")
        require(text(source.get("description")), "Source needs a description")
        source_ids.add(source["id"])

    facts = profile.get("facts")
    require(isinstance(facts, list) and bool(facts), "Profile needs facts")
    fact_ids = set()
    for fact in facts:
        require(isinstance(fact, dict), "Fact must be an object")
        require(text(fact.get("id")) and fact["id"] not in fact_ids,
                "Fact ids must be nonempty and unique")
        require(text(fact.get("text")), "Fact needs text")
        require(fact.get("visibility") in ("initial", "on_question"),
                "Unsupported fact visibility")
        topics = fact.get("topics")
        require(isinstance(topics, list) and bool(topics) and all(text(t) for t in topics),
                "Fact needs question topics")
        require(fact.get("source_id") in source_ids, "Fact references an unknown source")
        fact_ids.add(fact["id"])
    provenance = profile.get("provenance")
    require(isinstance(provenance, dict)
            and provenance.get("case_origin") == "faculty_provided_sample",
            "This library requires faculty-provided sample provenance")
    require(provenance.get("clinical_review_status") in ("not_reviewed", "reviewed"),
            "Profile needs a clinical review status")
    require(text(provenance.get("dataset_usage")), "Profile needs dataset usage disclosure")


def _load_profiles() -> dict[str, dict[str, Any]]:
    profiles = {}
    for path in sorted(PROFILE_DIRECTORY.glob("*.json")):
        profile = json.loads(path.read_text(encoding="utf-8"))
        validate_profile(profile)
        if profile["id"] in profiles:
            raise ProfileValidationError(f"Duplicate profile id: {profile['id']}")
        profiles[profile["id"]] = profile
    if not profiles:
        raise ProfileValidationError("No predefined profiles found")
    return profiles


def load_patient_profile(profile_id: str) -> dict[str, Any]:
    """Return fresh full case data for the server, raising KeyError if missing.

    Do not send this object to a student client: it includes unreleased facts,
    behavior instructions, and learning objectives.
    """
    return _load_profiles()[profile_id]


def _patient_card(profile: dict[str, Any]) -> dict[str, Any]:
    return {key: profile[key] for key in
            ("id", "version", "identity", "title", "summary", "provenance")}


def list_patient_cards() -> list[dict[str, Any]]:
    """Return library summaries without hidden case facts or instructions."""
    return [_patient_card(profile) for profile in _load_profiles().values()]


def get_patient_card(profile_id: str) -> dict[str, Any]:
    """Return a single library summary, raising KeyError if missing."""
    return _patient_card(load_patient_profile(profile_id))
