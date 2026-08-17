"""Operator-output regressions for the locked migration runner."""

import sys

import pytest

from scripts import migrate


class _FakeConnection:
    """Records statements and transaction outcomes without a database."""

    def __init__(self) -> None:
        self.queries: list[str] = []
        self.committed = False
        self.rolled_back = False

    def execute(self, statement: object, *_args: object, **_kwargs: object) -> None:
        self.queries.append(str(statement))

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.rolled_back = True

    def __enter__(self) -> _FakeConnection:
        return self

    def __exit__(self, *_exc: object) -> None:
        return None


class _FakeEngine:
    def __init__(self) -> None:
        self.connection = _FakeConnection()

    def connect(self) -> _FakeConnection:
        return self.connection

    def dispose(self) -> None:
        return None


class _RevisionReader:
    """Stand-in for `MigrationContext`, handing out scripted revisions."""

    def __init__(self, revisions: list[str | None]) -> None:
        self._revisions = list(revisions)

    def configure(self, _connection: object) -> _RevisionReader:
        return self

    def get_current_revision(self) -> str | None:
        if not self._revisions:
            return None
        return self._revisions.pop(0)


@pytest.fixture
def fake_engine(monkeypatch: pytest.MonkeyPatch) -> _FakeEngine:
    engine = _FakeEngine()

    def fake_create_engine(*_args: object, **_kwargs: object) -> _FakeEngine:
        return engine

    def fake_url() -> str:
        return "fake-url"

    monkeypatch.setattr(migrate, "create_engine", fake_create_engine)
    monkeypatch.setattr(migrate, "synchronous_database_url", fake_url)
    return engine


def _install_revisions(
    monkeypatch: pytest.MonkeyPatch, revisions: list[str | None]
) -> None:
    monkeypatch.setattr(migrate, "MigrationContext", _RevisionReader(revisions))


def _argv(monkeypatch: pytest.MonkeyPatch, *arguments: str) -> None:
    monkeypatch.setattr(sys, "argv", ["migrate.py", *arguments])


def _noop(*_args: object) -> None:
    return None


def test_upgrade_prints_the_applied_revision(
    fake_engine: _FakeEngine,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """A successful upgrade says which revision the database moved to."""
    _install_revisions(monkeypatch, ["rev-old", "rev-new"])
    ran: list[tuple[str, str]] = []

    def fake_upgrade(config: object, revision: str) -> None:
        ran.append(("upgrade", revision))

    monkeypatch.setattr(migrate.command, "upgrade", fake_upgrade)
    _argv(monkeypatch, "upgrade")

    assert migrate.main() == 0

    captured = capsys.readouterr()
    assert ran == [("upgrade", "head")]
    assert "Migration upgrade: revision rev-old -> rev-new" in captured.out
    assert captured.out.count("\n") == 1


def test_upgrade_at_head_reports_no_change(
    fake_engine: _FakeEngine,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Re-running against a current database says nothing was applied."""
    _install_revisions(monkeypatch, ["rev-head", "rev-head"])
    monkeypatch.setattr(migrate.command, "upgrade", _noop)
    _argv(monkeypatch, "upgrade")

    assert migrate.main() == 0

    captured = capsys.readouterr()
    assert "already at revision rev-head" in captured.out


def test_current_does_not_duplicate_alembics_own_output(
    fake_engine: _FakeEngine,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """`current` already prints the revision through Alembic itself; the
    runner must not add a second line for the same fact."""

    def fake_current(config: object, *_args: object) -> None:
        print("rev-head (head)")

    monkeypatch.setattr(migrate.command, "current", fake_current)
    _install_revisions(monkeypatch, ["rev-head", "rev-head"])
    _argv(monkeypatch, "current")

    assert migrate.main() == 0

    captured = capsys.readouterr()
    assert captured.out == "rev-head (head)\n"
    assert "Migration current:" not in captured.out


def test_failure_includes_error_message_on_one_bounded_line(
    fake_engine: _FakeEngine,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """Operators see why the migration failed, not only the exception type."""

    def failing_upgrade(config: object, revision: str) -> None:
        raise RuntimeError("disk full\nsecond line must stay out of stderr")

    monkeypatch.setattr(migrate.command, "upgrade", failing_upgrade)
    _install_revisions(monkeypatch, ["rev-old", "rev-old"])
    _argv(monkeypatch, "upgrade")

    assert migrate.main() == 1

    captured = capsys.readouterr()
    assert "RuntimeError: disk full" in captured.err
    assert "second line" not in captured.err
    assert "rolling back" in captured.err
    assert fake_engine.connection.rolled_back is True
    assert fake_engine.connection.committed is False


def test_advisory_lock_is_released_after_failure(
    fake_engine: _FakeEngine,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    """A failed command still unlocks, so later runners are not blocked."""

    def failing_upgrade(config: object, revision: str) -> None:
        raise RuntimeError("nope")

    monkeypatch.setattr(migrate.command, "upgrade", failing_upgrade)
    _install_revisions(monkeypatch, ["rev-old", "rev-old"])
    _argv(monkeypatch, "upgrade")

    assert migrate.main() == 1

    queries = fake_engine.connection.queries
    assert "SELECT pg_advisory_lock(:key)" in " ".join(queries)
    assert "SELECT pg_advisory_unlock(:key)" in " ".join(queries)
    assert queries.index("SELECT pg_advisory_unlock(:key)") > queries.index(
        "SELECT pg_advisory_lock(:key)"
    )
    capsys.readouterr()
