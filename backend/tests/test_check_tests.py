"""Both directions of every rule in the test-meaningfulness check.

Every fixture is a string literal rather than a real test, so this file stays
clean under the rules it exercises. Each rule is proven on a shape it must
report and on the nearest shape it must not.
"""

from scripts.check_tests import check_source

NO_ASSERTIONS = "def test_it():\n    do_the_thing()\n"
BARE_ASSERT = "def test_it():\n    assert do_the_thing() == 3\n"
RAISES_ONLY = (
    "def test_it():\n"
    "    with pytest.raises(ValueError, match='no'):\n"
    "        do_the_thing()\n"
)
ASSERT_HELPER_ONLY = "def test_it():\n    _assert_the_session_was_installed(response)\n"
CALL_ASSERTIONS_ONLY = (
    "def test_it():\n"
    "    service.run()\n"
    "    service.db.commit.assert_awaited_once()\n"
    "    service.notify.assert_called_once_with(7)\n"
)
CALL_ASSERTION_PLUS_OUTCOME = (
    "def test_it():\n"
    "    result = service.run()\n"
    "    service.db.commit.assert_awaited_once()\n"
    "    assert result.status == 'done'\n"
)
CALL_ATTRIBUTE_ONLY = (
    "def test_it():\n    service.run()\n    assert service.db.called\n"
)
ABSENCE_ONLY = (
    "def test_it():\n    service.run()\n    service.db.add.assert_not_called()\n"
)
SELF_COMPARISON = "def test_it():\n    assert compute(x) == compute(x)\n"
REAL_COMPARISON = "def test_it():\n    assert compute(x) == 12\n"
CONSTANT_ASSERT = "def test_it():\n    assert True\n"
NESTED_CALLBACK_ASSERTION = (
    "def test_it():\n"
    "    def _handler(request):\n"
    "        assert request.url == 'https://example.test'\n"
    "    install(_handler)\n"
)
NOT_A_TEST = "def helper():\n    do_the_thing()\n"


def _messages(source: str) -> list[str]:
    return [message for _line, message in check_source(source)]


def test_a_test_with_no_assertion_at_all_is_reported() -> None:
    assert len(_messages(NO_ASSERTIONS)) == 1
    assert "asserts nothing" in _messages(NO_ASSERTIONS)[0]


def test_a_plain_assert_is_accepted() -> None:
    assert _messages(BARE_ASSERT) == []


def test_a_raises_block_counts_as_the_assertion() -> None:
    assert _messages(RAISES_ONLY) == []


def test_a_shared_assert_helper_counts_as_the_assertion() -> None:
    """The suite's `_assert_*` helpers hold the assertions for several tests."""
    assert _messages(ASSERT_HELPER_ONLY) == []


def test_a_test_whose_every_assertion_inspects_a_mock_is_reported() -> None:
    reported = _messages(CALL_ASSERTIONS_ONLY)
    assert len(reported) == 1
    assert "inspects a mock" in reported[0]


def test_one_outcome_assertion_rescues_the_call_assertions_beside_it() -> None:
    assert _messages(CALL_ASSERTION_PLUS_OUTCOME) == []


def test_asserting_a_mocks_own_call_bookkeeping_is_not_an_outcome() -> None:
    """`assert mock.called` is a call assertion wearing a statement's clothes."""
    assert len(_messages(CALL_ATTRIBUTE_ONLY)) == 1


def test_an_absence_assertion_is_an_outcome() -> None:
    """When the claim is that nothing happened, the missing call is the outcome."""
    assert _messages(ABSENCE_ONLY) == []


def test_an_assertion_comparing_an_expression_with_itself_is_reported() -> None:
    reported = _messages(SELF_COMPARISON)
    assert len(reported) == 1
    assert "cannot fail" in reported[0]


def test_a_comparison_against_a_real_expectation_is_accepted() -> None:
    assert _messages(REAL_COMPARISON) == []


def test_asserting_a_truthy_constant_is_reported() -> None:
    reported = _messages(CONSTANT_ASSERT)
    assert len(reported) == 1
    assert "always true" in reported[0]


def test_an_assertion_inside_an_installed_callback_counts() -> None:
    """The transport-handler tests keep their assertions in a callback.

    `conftest.py` builds `httpx.MockTransport` clients whose handler asserts on
    the request it is handed. Ignoring callback bodies would report the most
    thorough tests in this suite as asserting nothing.
    """
    assert _messages(NESTED_CALLBACK_ASSERTION) == []


def test_a_function_that_is_not_a_test_is_ignored() -> None:
    assert _messages(NOT_A_TEST) == []
