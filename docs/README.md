# League Analysis Documentation

This index identifies the maintained source for each durable project topic.
Jira project `LGA` remains the source for task planning and execution state.

| Topic | Authoritative document or source | Responsibility |
| --- | --- | --- |
| Documentation governance | [`AGENTS.md`](AGENTS.md) | Ownership, co-update, and validation rules for `docs/` |
| Project summary, structure, stack, and commands | [`project-overview.md`](project-overview.md) | Current repository map and local tooling |
| Quality checks and CI | [`quality-checks.md`](quality-checks.md) | Local/focused gates, test coverage, tool pins, and GitHub-only checks |
| GitHub branch governance | [`github-governance.md`](github-governance.md) | `master` ruleset requirements and required checks |
| Configurable card catalog (LGA-23 approved contract) | [`card-configuration.md`](card-configuration.md) | Owner-approved v1 catalog, paired typed settings contract, defaults, and migration rules for the first configurable analytical cards |
| Database schema revisions | [`../backend/alembic/versions/`](../backend/alembic/versions/) | Ordered executable PostgreSQL schema source of truth |
| Database model and change workflow | [`database.md`](database.md) | Maintained explanation of the schema and safe updates |
| Riot API integration | [`riot-api.md`](riot-api.md) | Routing, endpoints, credentials, rate limits, and integration boundaries |
| Background jobs | [`jobs.md`](jobs.md) | Scheduler lifecycle, job behavior, controls, and API surface |
| Cookie/storage consent | [`cookie-consent-compliance.md`](cookie-consent-compliance.md) | Compliance baseline and implementation boundary |
| Matchmaking analysis | [`matchmaking-analysis.md`](matchmaking-analysis.md) | Algorithm, data flow, persistence, API, and UI behavior |

The root [`README.md`](../README.md) is the public project introduction. The
root [`AGENTS.md`](../AGENTS.md) is the mandatory repository instruction map;
nested agent guides provide only subtree-specific conventions.

## Public source release

[Public release preparation](public-release.md) owns publication boundaries,
Riot policy review, and history exposure decisions.
