# League Analysis Documentation

This index identifies the maintained source for each durable project topic.
Jira project `LGA` remains the source for task planning and execution state.

| Topic | Authoritative document or source | Responsibility |
| --- | --- | --- |
| Documentation governance | [`AGENTS.md`](AGENTS.md) | Ownership, co-update, and validation rules for `docs/` |
| Project summary, structure, stack, and commands | [`project-overview.md`](project-overview.md) | Current repository map and local tooling |
| Production containers and Pi deployment | [`deployment.md`](deployment.md) | Docker images, Compose topology, pi5ram16 deployment, health, and container QA |
| Quality checks and CI | [`quality-checks.md`](quality-checks.md) | Local/focused gates, test coverage, tool pins, and GitHub-only checks |
| GitHub branch governance | [`github-governance.md`](github-governance.md) | `master` ruleset desired state, required checks, and drift audit |
| Runtime/dependency review (2026-08-03) | [`dependency-upgrade-2026-08-03.md`](dependency-upgrade-2026-08-03.md) | Historical snapshot (superseded by the 2026-08-11 review and live manifests) |
| Runtime/dependency review (2026-08-11) | [`dependency-upgrade-2026-08-11.md`](dependency-upgrade-2026-08-11.md) | Historical snapshot (live manifests and lockfiles are current authority) |
| Configurable card catalog (LGA-23 approved contract) | [`card-configuration.md`](card-configuration.md) | Owner-approved v1 catalog, paired typed settings contract, defaults, and migration rules for the first configurable analytical cards |
| AI development and QA lifecycle | [`ai-development-flow.md`](ai-development-flow.md) | Lifecycle index; the authoritative procedures are the `flow1`/`flow2`/`qa1`/`qa2` skills in [`../.claude/skills/`](../.claude/skills/) |
| Database schema revisions | [`../backend/alembic/versions/`](../backend/alembic/versions/) | Ordered executable PostgreSQL schema source of truth |
| Database model and change workflow | [`database.md`](database.md) | Maintained explanation of the schema and safe updates |
| Riot API integration | [`riot-api.md`](riot-api.md) | Routing, endpoints, credentials, rate limits, and integration boundaries |
| Riot API compatibility audit (2026-08-03) | [`riot-api-compatibility-2026-08-03.md`](riot-api-compatibility-2026-08-03.md) | Historical snapshot (implemented by LGA-42; current authority is the code and `riot-api.md`) |
| Background jobs | [`jobs.md`](jobs.md) | Scheduler lifecycle, job behavior, controls, and API surface |
| Cookie/storage consent | [`cookie-consent-compliance.md`](cookie-consent-compliance.md) | Compliance baseline and implementation boundary |
| Matchmaking analysis | [`matchmaking-analysis.md`](matchmaking-analysis.md) | Algorithm, data flow, persistence, API, and UI behavior |

The root [`README.md`](../README.md) is the private repository entry point. The
root [`AGENTS.md`](../AGENTS.md) is the mandatory repository instruction map;
nested agent guides provide only subtree-specific conventions.
