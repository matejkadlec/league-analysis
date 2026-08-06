"""Migration-adoption baseline and upgrade regression coverage."""

from argparse import Namespace
from types import SimpleNamespace

from scripts import adopt_migrations


def test_existing_application_row_counts_preserve_existing_tables_only() -> None:
    """A newly created migration table may appear without changing old data."""
    before_counts = {"auth.users": 2}

    assert adopt_migrations.existing_application_row_counts_unchanged(
        before_counts,
        {"auth.users": 2, "auth.user_card_preferences": 0},
    )
    assert not adopt_migrations.existing_application_row_counts_unchanged(
        before_counts,
        {"auth.users": 1, "auth.user_card_preferences": 0},
    )


def test_adoption_stamps_the_initial_baseline_before_upgrading_to_head(
    monkeypatch,
) -> None:
    """An unmarked initial schema receives later revisions only after adoption."""
    target_database = "league_analysis_local_dev"
    temporary_database = "lga_migration_adoption_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    commands: list[tuple[str, str, str]] = []
    row_counts = iter(
        [
            {"auth.users": 2},
            {"auth.users": 2, "auth.user_card_preferences": 0},
        ]
    )
    revisions = iter([None, adopt_migrations.EXPECTED_REVISION])

    monkeypatch.setattr(
        adopt_migrations,
        "parse_arguments",
        lambda: Namespace(database=target_database, apply=True),
    )
    monkeypatch.setattr(
        adopt_migrations, "stamped_revision", lambda _database: next(revisions)
    )
    monkeypatch.setattr(
        adopt_migrations,
        "uuid4",
        lambda: SimpleNamespace(hex="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    )
    monkeypatch.setattr(adopt_migrations, "administration_url", lambda: object())
    monkeypatch.setattr(
        adopt_migrations, "create_temporary_database", lambda *_args: None
    )
    monkeypatch.setattr(
        adopt_migrations, "drop_temporary_database", lambda *_args: None
    )
    monkeypatch.setattr(
        adopt_migrations,
        "run_migration_command",
        lambda database, command, revision: commands.append(
            (database, command, revision)
        ),
    )
    monkeypatch.setattr(
        adopt_migrations,
        "normalized_schema_dump",
        lambda _database: ["matching schema"],
    )
    monkeypatch.setattr(
        adopt_migrations,
        "application_row_counts",
        lambda _database: next(row_counts),
    )

    assert adopt_migrations.main() == 0
    assert commands == [
        (
            temporary_database,
            "upgrade",
            adopt_migrations.ADOPTION_BASELINE_REVISION,
        ),
        (
            target_database,
            "stamp",
            adopt_migrations.ADOPTION_BASELINE_REVISION,
        ),
        (target_database, "upgrade", adopt_migrations.EXPECTED_REVISION),
    ]
