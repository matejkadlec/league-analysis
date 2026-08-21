"""Regression coverage for complete, stable champion-statistics responses."""

from types import SimpleNamespace

from app.features.matches.service import MatchService


class _Result:
    def __init__(self, participants: list[SimpleNamespace]) -> None:
        self._participants = participants

    def scalars(self) -> SimpleNamespace:
        return SimpleNamespace(all=lambda: self._participants)


class _Session:
    def __init__(self, participants: list[SimpleNamespace]) -> None:
        self._participants = participants
        self.statements: list[object] = []

    async def execute(self, statement: object) -> _Result:
        self.statements.append(statement)
        return _Result(self._participants)


def _participant(
    champion_name: str,
    champion_id: int,
    *,
    games: int,
) -> list[SimpleNamespace]:
    return [
        SimpleNamespace(
            champion_name=champion_name,
            champion_id=champion_id,
            win=game % 2 == 0,
            kills=game + 1,
            deaths=1,
            assists=game,
        )
        for game in range(games)
    ]


async def test_champion_stats_returns_every_champion_with_stable_ties() -> None:
    """Local pagination can reach aggregates beyond the former twenty-row limit."""
    participants = [
        *_participant("Zed", 238, games=3),
        *_participant("Ahri", 103, games=3),
    ]
    for index in range(21):
        participants.extend(_participant(f"Champion{index:02d}", index + 1, games=1))

    session = _Session(participants)
    service = MatchService(session)  # type: ignore[arg-type]

    response = await service.get_player_champion_stats("test-puuid", queue_ids=None)

    # The double answers every query with the same rows, so only the statement
    # itself can say whether the twenty-row cap came back. It did once, and
    # every player with more than twenty champions silently lost the tail.
    assert "LIMIT" not in str(session.statements[0])

    assert response.total_champions == 23
    assert len(response.champions) == 23
    assert [champion.champion_name for champion in response.champions[:2]] == [
        "Ahri",
        "Zed",
    ]
    assert response.champions[-1].champion_name == "Champion20"
