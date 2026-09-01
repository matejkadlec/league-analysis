"""Which routes require a signed-in user, and which require an admin.

`main.py` mounts every router with no global dependency, so route-level
dependencies are the only authorization boundary; PUBLIC is a claim too.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Literal, Protocol, cast

from fastapi import APIRouter, params
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.main import app

Guard = Literal["PUBLIC", "USER", "ADMIN"]

ROUTE_GUARDS: dict[tuple[str, str], Guard] = {
    ("POST", "/api/v1/auth/change-email/request-code"): "USER",
    ("POST", "/api/v1/auth/change-email/verify"): "USER",
    ("POST", "/api/v1/auth/change-password"): "USER",
    ("POST", "/api/v1/auth/join-us/contact"): "PUBLIC",
    ("POST", "/api/v1/auth/login"): "PUBLIC",
    ("POST", "/api/v1/auth/logout"): "PUBLIC",
    ("GET", "/api/v1/auth/me"): "USER",
    ("PATCH", "/api/v1/auth/me"): "USER",
    ("POST", "/api/v1/auth/refresh"): "PUBLIC",
    ("POST", "/api/v1/auth/register"): "PUBLIC",
    ("GET", "/api/v1/auth/users"): "ADMIN",
    ("GET", "/api/v1/jobs/"): "ADMIN",
    ("GET", "/api/v1/jobs/executions/all"): "ADMIN",
    ("GET", "/api/v1/jobs/status/overview"): "ADMIN",
    ("PUT", "/api/v1/jobs/{job_id}"): "ADMIN",
    ("GET", "/api/v1/jobs/{job_id}/executions"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/pause"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/resume"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/stop"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/test"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/test/pause"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/test/resume"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/test/stop"): "ADMIN",
    ("POST", "/api/v1/jobs/{job_id}/trigger"): "ADMIN",
    ("GET", "/api/v1/matches/player/{puuid}/champion-stats"): "USER",
    ("GET", "/api/v1/matches/player/{puuid}/detailed"): "USER",
    ("GET", "/api/v1/matches/player/{puuid}/lane-stats"): "USER",
    ("GET", "/api/v1/matches/player/{puuid}/stats"): "USER",
    ("GET", "/api/v1/matchmaking-analysis/player/{puuid}"): "USER",
    ("DELETE", "/api/v1/matchmaking-analysis/player/{puuid}/analysis"): "USER",
    ("DELETE", "/api/v1/matchmaking-analysis/player/{puuid}/cancel"): "USER",
    ("GET", "/api/v1/matchmaking-analysis/player/{puuid}/history"): "USER",
    ("GET", "/api/v1/matchmaking-analysis/player/{puuid}/latest-completed"): "USER",
    ("GET", "/api/v1/matchmaking-analysis/player/{puuid}/status"): "USER",
    ("POST", "/api/v1/matchmaking-analysis/start"): "USER",
    ("GET", "/api/v1/players/context"): "USER",
    ("PUT", "/api/v1/players/context/current"): "USER",
    ("POST", "/api/v1/players/discover"): "USER",
    ("GET", "/api/v1/players/suggestions"): "USER",
    ("GET", "/api/v1/players/tracked/list"): "USER",
    ("GET", "/api/v1/players/{puuid}"): "USER",
    ("GET", "/api/v1/players/{puuid}/league"): "USER",
    ("POST", "/api/v1/players/{puuid}/sync"): "USER",
    ("GET", "/api/v1/players/{puuid}/sync/active"): "USER",
    ("GET", "/api/v1/players/{puuid}/sync/{sync_id}"): "USER",
    ("DELETE", "/api/v1/players/{puuid}/track"): "USER",
    ("POST", "/api/v1/players/{puuid}/track"): "USER",
    ("POST", "/api/v1/playstyle-analysis/analyze"): "USER",
    ("GET", "/api/v1/playstyle-analysis/player/{puuid}"): "USER",
    ("GET", "/api/v1/settings/card-preferences"): "USER",
    ("DELETE", "/api/v1/settings/card-preferences/{card_id}"): "USER",
    ("PUT", "/api/v1/settings/card-preferences/{card_id}"): "USER",
    ("GET", "/api/v1/settings/riot_api_key"): "ADMIN",
    ("PUT", "/api/v1/settings/riot_api_key"): "ADMIN",
    ("POST", "/api/v1/settings/riot_api_key/test"): "ADMIN",
    ("GET", "/api/v1/settings/service-status"): "USER",
    ("GET", "/api/v1/settings/user/cookie-consent"): "USER",
    ("PUT", "/api/v1/settings/user/cookie-consent"): "USER",
    ("POST", "/api/v1/smurf-boost-detection/analyze"): "USER",
    ("GET", "/api/v1/smurf-boost-detection/player/{puuid}"): "USER",
    ("GET", "/api/v1/smurf-boost-detection/presets"): "USER",
    ("GET", "/health/ready"): "PUBLIC",
}


class _IncludeContext(Protocol):
    """The half of FastAPI's include record that carries the mounted prefix."""

    @property
    def prefix(self) -> str: ...

    @property
    def dependencies(self) -> Sequence[params.Depends]: ...


class _IncludedRouter(Protocol):
    """FastAPI 0.141 keeps each `include_router` call as one of these.

    They are not `APIRoute`s and are not publicly typed, so the two attributes
    this file reads are named here rather than `getattr`-ed at every use.
    """

    @property
    def include_context(self) -> _IncludeContext: ...

    @property
    def original_router(self) -> APIRouter: ...


def _guard_names(dependant: Dependant, found: set[str]) -> None:
    """Every dependency callable reachable from one route, by name."""
    for sub in dependant.dependencies:
        if sub.call is not None:
            found.add(getattr(sub.call, "__name__", str(sub.call)))
        _guard_names(sub, found)


def _tier(dependency_names: set[str]) -> Guard:
    if "get_current_admin_user" in dependency_names:
        return "ADMIN"
    if "get_current_active_user" in dependency_names:
        return "USER"
    return "PUBLIC"


def _method(route: APIRoute) -> str:
    """The one verb a route is registered under.

    `APIRoute.methods` is typed optional by Starlette but never is one here.
    """
    assert route.methods, f"{route.path} is registered under no HTTP method"
    return sorted(route.methods)[0]


def _dependency_names(dependencies: Sequence[params.Depends]) -> set[str]:
    return {
        getattr(dependency.dependency, "__name__", str(dependency.dependency))
        for dependency in dependencies
        if dependency.dependency is not None
    }


def _observed_guards() -> dict[tuple[str, str], Guard]:
    """The tier each registered route actually enforces.

    Router-level dependencies live on the include record, not the route, so they
    must be unioned in or every jobs route reads unguarded.
    """
    observed: dict[tuple[str, str], Guard] = {}
    for entry in app.routes:
        if isinstance(entry, APIRoute):
            found: set[str] = set()
            _guard_names(entry.dependant, found)
            observed[(_method(entry), entry.path)] = _tier(found)
            continue
        if type(entry).__name__ != "_IncludedRouter":
            continue

        include = cast(_IncludedRouter, entry)
        context = include.include_context
        router_level = _dependency_names(
            [*include.original_router.dependencies, *context.dependencies]
        )
        for route in include.original_router.routes:
            if not isinstance(route, APIRoute):
                continue
            found = set(router_level)
            _guard_names(route.dependant, found)
            observed[(_method(route), context.prefix + route.path)] = _tier(found)
    return observed


def test_the_route_walk_still_finds_the_routes() -> None:
    """The guard on the guard: a walk that finds nothing must not pass."""
    assert len(_observed_guards()) >= 60


def test_every_route_enforces_the_tier_it_is_listed_under() -> None:
    observed = _observed_guards()
    drifted = sorted(
        f"{method} {path}: listed {ROUTE_GUARDS[(method, path)]}, enforces {tier}"
        for (method, path), tier in observed.items()
        if (method, path) in ROUTE_GUARDS and ROUTE_GUARDS[(method, path)] != tier
    )
    assert not drifted, (
        "these routes no longer enforce what they are listed as:\n  "
        + "\n  ".join(drifted)
    )


def test_no_route_is_missing_from_the_table() -> None:
    """A new route has to declare its tier here, including a public one."""
    observed = _observed_guards()
    unlisted = sorted(
        f"{method} {path}"
        for method, path in observed
        if (method, path) not in ROUTE_GUARDS
    )
    removed = sorted(
        f"{method} {path}"
        for method, path in ROUTE_GUARDS
        if (method, path) not in observed
    )
    assert not unlisted, (
        "routes with no entry in ROUTE_GUARDS:\n  "
        + "\n  ".join(unlisted)
        + "\n\nAdd them with the tier they are meant to have, not the tier "
        "they happen to have."
    )
    assert not removed, (
        "ROUTE_GUARDS lists routes this app no longer serves:\n  "
        + "\n  ".join(removed)
    )
