# League Analysis Documentation

This index identifies the maintained source for each durable project topic.
Jira project `LGA` remains the source for task planning and execution state.

| Topic | Authoritative document or source | Responsibility |
| --- | --- | --- |
| Documentation governance | [`AGENTS.md`](AGENTS.md) | Ownership, co-update, and validation rules for `docs/` |
| Project summary, structure, stack, and commands | [`project-overview.md`](project-overview.md) | Current repository map and local tooling |
| AI development and QA lifecycle | [`ai-development-flow.md`](ai-development-flow.md) | Jira, batching, QA, Git, pull request, and handoff rules |
| Database schema | [`../backend/init_database.sql`](../backend/init_database.sql) | Executable PostgreSQL schema source of truth |
| Database model and change workflow | [`database.md`](database.md) | Maintained explanation of the schema and safe updates |
| Riot API integration | [`riot-api.md`](riot-api.md) | Routing, endpoints, credentials, rate limits, and integration boundaries |
| Background jobs | [`jobs.md`](jobs.md) | Scheduler lifecycle, job behavior, controls, and API surface |
| Cookie/storage consent | [`cookie-consent-compliance.md`](cookie-consent-compliance.md) | Compliance baseline and implementation boundary |
| Matchmaking analysis | [`matchmaking-analysis.md`](matchmaking-analysis.md) | Algorithm, data flow, persistence, API, and UI behavior |

The root [`README.md`](../README.md) is the public repository landing page. The
root [`AGENTS.md`](../AGENTS.md) is the mandatory repository instruction map;
nested agent guides provide only subtree-specific conventions.
