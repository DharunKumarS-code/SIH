"""Data provenance labelling (spec sections 4 and 38).

`isOfficial` is ALWAYS False from this module — Phase 5 never sources or
fabricates authoritative government elevation data, and no combination of
inputs can flip this to an OFFICIAL result.
"""
from __future__ import annotations

VALID_SOURCES = ("ELEVATION_DEMO", "RESEARCH_DATA", "TEST_FIXTURE", "USER_SUPPLIED")

_CLASSIFICATION = {
    "ELEVATION_DEMO": "DEMO_RESEARCH_DATA",
    "RESEARCH_DATA": "DEMO_RESEARCH_DATA",
    "TEST_FIXTURE": "TEST_FIXTURE",
    "USER_SUPPLIED": "USER_SUPPLIED_DATA",
}


def normalise_source(label: str | None) -> str:
    label = (label or "").strip().upper()
    return label if label in VALID_SOURCES else "ELEVATION_DEMO"


def build(source_label: str | None, dataset_name: str | None = None, notes: list | None = None) -> dict:
    source = normalise_source(source_label)
    return {
        "source": source,
        "dataset": dataset_name,
        "dataClassification": _CLASSIFICATION[source],
        "isOfficial": False,
        "dataAvailability": "AVAILABLE",
        "notes": notes or [],
    }


def unavailable(reason: str) -> dict:
    return {
        "source": None,
        "dataset": None,
        "dataClassification": None,
        "isOfficial": False,
        "dataAvailability": "UNAVAILABLE",
        "notes": [reason],
    }
