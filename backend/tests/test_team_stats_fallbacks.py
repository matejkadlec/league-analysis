"""Where each team objective total comes from, per team, per match.

Two sources feed the same nine numbers: the timeline aggregate row when the
match has one, and the participants' own counters when it does not. Nothing
pinned which wins, so the max()/or_zero chain and the derived voidgrub count
could have been rewritten without anything going red.
"""

from app.features.matches.match_history import build_team_compositions_and_stats
from app.features.matches.participants import MatchParticipant
from app.features.matches.timeline import MatchTimeline


def participant(
    team_id: int,
    *,
    kills: int = 0,
    deaths: int = 0,
    assists: int = 0,
    turret_kills: int = 0,
    inhibitor_kills: int = 0,
    advanced: dict[str, int] | None = None,
) -> MatchParticipant:
    return MatchParticipant(
        match_id="EUW1_1",
        puuid=f"p{team_id}-{kills}-{assists}",
        game_name=f"Player{team_id}",
        tag_line="EUW",
        champion_id=1,
        champion_name="Annie",
        team_position="MIDDLE",
        team_id=team_id,
        kills=kills,
        deaths=deaths,
        assists=assists,
        turret_kills=turret_kills,
        inhibitor_kills=inhibitor_kills,
        advanced_stats=advanced or {},
    )


def timeline(team_id: int, **totals: int) -> MatchTimeline:
    return MatchTimeline(match_id="EUW1_1", puuid="t", team_id=team_id, **totals)


def test_a_team_with_a_timeline_row_reports_the_timeline_numbers() -> None:
    """The participants' own turret counter does not add to a timeline total."""
    _, stats = build_team_compositions_and_stats(
        [participant(100, kills=3, turret_kills=4)],
        {
            100: timeline(
                100,
                team_turrets_destroyed=9,
                team_inhibitors_destroyed=2,
                team_dragons_slain=3,
                team_barons_slain=1,
                team_rift_heralds_slain=1,
                team_voidgrubs_slain=6,
            )
        },
    )

    assert stats.blue_team.turrets == 9
    assert stats.blue_team.voidgrubs == 6
    # Kills always come from the participants, timeline or not.
    assert stats.blue_team.kills == 3


def test_without_a_timeline_the_participants_supply_every_objective() -> None:
    """Turrets sum, dragons/barons/heralds take the highest claim.

    The three team-wide counts are each participant's view of the same team
    number, so the largest is the team's -- summing them would multiply the
    team's barons by the number of players who saw them.
    """
    _, stats = build_team_compositions_and_stats(
        [
            participant(
                100,
                turret_kills=2,
                inhibitor_kills=1,
                advanced={
                    "teamBaronKills": 1,
                    "teamRiftHeraldKills": 1,
                    "dragonTakedowns": 2,
                    "voidMonsterKill": 5,
                },
            ),
            participant(
                100,
                turret_kills=3,
                advanced={
                    "teamBaronKills": 1,
                    "teamRiftHeraldKills": 1,
                    "dragonTakedowns": 1,
                    "voidMonsterKill": 4,
                },
            ),
        ],
        {},
    )

    assert stats.blue_team.turrets == 5
    assert stats.blue_team.inhibitors == 1
    assert stats.blue_team.dragons == 2
    assert stats.blue_team.barons == 1
    assert stats.blue_team.rift_heralds == 1
    # voidMonsterKill counts barons and heralds too, so they come back off.
    assert stats.blue_team.voidgrubs == 3


def test_a_void_monster_count_below_the_epics_never_goes_negative() -> None:
    _, stats = build_team_compositions_and_stats(
        [
            participant(
                100,
                advanced={
                    "teamBaronKills": 2,
                    "teamRiftHeraldKills": 2,
                    "voidMonsterKill": 1,
                },
            )
        ],
        {},
    )

    assert stats.blue_team.voidgrubs == 0


def test_each_team_reads_only_its_own_participants() -> None:
    _, stats = build_team_compositions_and_stats(
        [participant(100, kills=5), participant(200, kills=2, deaths=5)],
        {},
    )

    assert (stats.blue_team.kills, stats.blue_team.deaths) == (5, 0)
    assert (stats.red_team.kills, stats.red_team.deaths) == (2, 5)
