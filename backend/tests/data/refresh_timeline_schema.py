"""Refresh the vendored Match-V5 timeline schema from Riot's published spec.

Vendored rather than fetched at test time because the suite is offline by
construction (`--disable-socket`). Source, regenerated daily from the Riot API
Reference: https://github.com/MingweiSamuel/riotapi-schema, `gh-pages` branch.

Example:
    curl -sSfL https://raw.githubusercontent.com/MingweiSamuel/riotapi-schema/gh-pages/openapi-3.0.0.json \
      | uv run --project backend python backend/tests/data/refresh_timeline_schema.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# An OpenAPI document is arbitrary JSON, and this is what "arbitrary JSON"
# honestly is. Spelling it out keeps the traversal below checkable, where a
# bare `Any` would silently accept anything it walked into.
type JsonValue = (
    dict[str, "JsonValue"] | list["JsonValue"] | str | int | float | bool | None
)
type Schema = dict[str, JsonValue]

ROOT_SCHEMA = "match-v5.TimelineDto"
TARGET = Path(__file__).with_name("riot_match_v5_timeline_schema.json")
SOURCE_URL = (
    "https://github.com/MingweiSamuel/riotapi-schema (gh-pages, openapi-3.0.0.json)"
)


def collect(schemas: dict[str, Schema], root: str) -> dict[str, Schema]:
    """Return `root` and every schema reachable from it, following $ref."""
    collected: dict[str, Schema] = {}

    def visit(name: str) -> None:
        if name in collected:
            return
        schema = schemas[name]
        collected[name] = schema
        _follow(schema)

    def _follow(node: JsonValue) -> None:
        if isinstance(node, dict):
            reference = node.get("$ref")
            if isinstance(reference, str):
                referenced = reference.rsplit("/", 1)[-1]
                if referenced in schemas:
                    visit(referenced)
            for value in node.values():
                _follow(value)
        elif isinstance(node, list):
            for value in node:
                _follow(value)

    visit(root)
    return collected


def main() -> int:
    specification = json.load(sys.stdin)
    schemas = specification["components"]["schemas"]
    if ROOT_SCHEMA not in schemas:
        print(
            f"error: {ROOT_SCHEMA} is absent from the fetched specification",
            file=sys.stderr,
        )
        return 1

    collected = collect(schemas, ROOT_SCHEMA)
    document = {
        "_provenance": {
            "source": SOURCE_URL,
            "note": (
                "Auto-generated daily from the Riot API Reference. Vendored so "
                "the drift test stays offline."
            ),
            "spec_version": specification["info"]["version"],
            "root": ROOT_SCHEMA,
            "refresh": "see backend/tests/data/refresh_timeline_schema.py",
        },
        "schemas": {name: collected[name] for name in sorted(collected)},
    }

    with TARGET.open("w", encoding="utf-8") as handle:
        json.dump(document, handle, indent=2)
        handle.write("\n")

    print(f"wrote {TARGET} ({len(collected)} schemas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
