"""Print the FastAPI OpenAPI document, for the contract check in the frontend.

`frontend/tests/api-contract-alignment.test.ts` compares this against the JSON
Schema of every exported zod schema; only this side can import the app.
"""

import json

from app.main import app


def main() -> None:
    """Write the document to stdout so the caller chooses where it lands."""
    print(json.dumps(app.openapi()))


if __name__ == "__main__":
    main()
