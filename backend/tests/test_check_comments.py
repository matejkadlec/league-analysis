"""Block-grouping and marker regressions for the comment-hygiene check.

Every fixture is a string literal rather than real comments, so this file
stays clean under the rules it exercises.
"""

from scripts.check_comments import check_source, main

RUN_OF_THREE = "\n".join(f"# line {index}" for index in range(3))
RUN_OF_TWO = "\n".join(f"# line {index}" for index in range(2))
SPLIT_RUNS = "\n".join(["# a", "# b", "value = 1", "# c", "# d"])
TRAILING_THEN_RUN = "\n".join(["value = 1  # why", "# b", "# c"])
TRAILING_BREAKS_A_RUN = "\n".join(["# a", "# b", "value = 1  # why", "# d"])
LONG_DOCSTRING = '"""Summary.\n\none\ntwo\nthree\n"""'
DOCSTRING_AT_CEILING = '"""Summary.\n\none\ntwo\n"""'
DOCUMENTED_INTERFACE = (
    "def f(a, b):\n"
    '    """Summary.\n'
    "\n"
    "    Args:\n"
    "        a: first, and a long enough description to run\n"
    "            onto a second line.\n"
    "        b: second.\n"
    "\n"
    "    Returns:\n"
    "        Something.\n"
    '    """\n'
)
NARRATION_UNDER_A_SECTION = (
    "def f(a):\n"
    '    """Summary.\n'
    "\n"
    "    Args:\n"
    "        a: first.\n"
    "\n"
    "    one\n"
    "    two\n"
    "    three\n"
    '    """\n'
)


def _messages(source: str) -> list[str]:
    return [message for _line, message in check_source(source)]


def test_a_run_past_the_ceiling_is_one_reported_block() -> None:
    reported = check_source(RUN_OF_THREE)
    assert len(reported) == 1
    assert reported[0][0] == 1
    assert "3 lines of prose" in reported[0][1]


def test_a_run_at_the_ceiling_passes() -> None:
    assert check_source(RUN_OF_TWO) == []


def test_code_between_comments_splits_the_run() -> None:
    assert check_source(SPLIT_RUNS) == []


def test_a_trailing_comment_opens_a_block_the_next_lines_join() -> None:
    reported = check_source(TRAILING_THEN_RUN)
    assert len(reported) == 1
    assert "3 lines of prose" in reported[0][1]


def test_a_trailing_comment_ends_the_run_before_it() -> None:
    assert check_source(TRAILING_BREAKS_A_RUN) == []


def test_a_docstring_past_the_ceiling_is_reported() -> None:
    reported = check_source(LONG_DOCSTRING)
    assert len(reported) == 1
    assert "3 lines of prose past its summary" in reported[0][1]


def test_a_docstring_at_the_ceiling_passes() -> None:
    assert check_source(DOCSTRING_AT_CEILING) == []


def test_a_structured_section_is_documentation_not_prose() -> None:
    assert check_source(DOCUMENTED_INTERFACE) == []


def test_narration_dedented_back_out_of_a_section_still_counts() -> None:
    reported = check_source(NARRATION_UNDER_A_SECTION)
    assert len(reported) == 1
    assert "3 lines of prose past its summary" in reported[0][1]


def test_deferral_and_compat_markers_are_reported() -> None:
    source = "\n".join(
        [
            "# TODO: wire this up",
            "value = 1  # kept for compat",
        ]
    )
    messages = _messages(source)
    assert any("no-deferral-comments" in message for message in messages)
    assert any("no-compat-shims" in message for message in messages)


def test_a_string_mentioning_the_marker_words_is_not_a_hit() -> None:
    assert check_source('value = "legacy format"\n') == []


def test_a_declared_name_announcing_an_old_path_is_a_hit() -> None:
    source = "\n".join(
        [
            "def legacy_reader() -> None: ...",
            "class DeprecatedThing: ...",
            "deprecated_total: int = 0",
        ]
    )
    assert len(check_source(source)) == 3


def test_a_deprecated_decorator_is_a_hit() -> None:
    assert len(check_source("@warnings.deprecated('x')\ndef read() -> None: ...")) == 1


LONG_ATTRIBUTE_DOCSTRING = 'X = 1\n"""Summary.\n\none\ntwo\nthree\n"""'
ATTRIBUTE_DOCSTRING_AT_CEILING = 'X = 1\n"""Summary.\n\none\ntwo\n"""'


def test_an_attribute_docstring_past_the_ceiling_is_reported() -> None:
    reported = check_source(LONG_ATTRIBUTE_DOCSTRING)
    assert len(reported) == 1
    assert "3 lines of prose past its summary" in reported[0][1]


def test_an_attribute_docstring_at_the_ceiling_passes() -> None:
    assert check_source(ATTRIBUTE_DOCSTRING_AT_CEILING) == []


def test_a_tool_directive_line_is_not_prose() -> None:
    source = "\n".join(["# one", "# noqa: E501", "# two", "value = 1"])
    assert check_source(source) == []


def test_a_directive_cannot_split_an_over_ceiling_run() -> None:
    source = "\n".join(["# one", "# noqa: E501", "# two", "# three", "value = 1"])
    reported = check_source(source)
    assert len(reported) == 1
    assert "3 lines of prose" in reported[0][1]


def test_a_deferral_marker_in_a_docstring_is_reported() -> None:
    messages = _messages('"""Summary.\n\nTODO: finish this.\n"""')
    assert any("no-deferral-comments" in message for message in messages)


def test_an_over_ceiling_fstring_statement_is_reported() -> None:
    source = 'x = 1\nf"""Summary.\n\none {x}\ntwo\nthree\n"""'
    reported = check_source(source)
    assert len(reported) == 1
    assert "3 lines of prose past its summary" in reported[0][1]


def test_an_over_ceiling_string_in_a_nested_block_is_reported() -> None:
    source = 'with open("x") as fh:\n    """Summary.\n\n    one\n    two\n    three\n    """\n    fh.read()\n'
    reported = check_source(source)
    assert len(reported) == 1


def test_a_marker_after_a_trailing_directive_is_still_reported() -> None:
    messages = _messages("x = 1  # noqa: E501  temporary until the fix\n")
    assert any("no-deferral-comments" in message for message in messages)


def test_an_uppercase_noqa_is_a_directive_too() -> None:
    source = "\n".join(["# one", "# NOQA: F401", "# two", "value = 1"])
    assert check_source(source) == []


def test_an_over_ceiling_tstring_statement_is_reported() -> None:
    source = 'x = 1\nt"""Summary.\n\none {x}\ntwo\nthree\n"""'
    reported = check_source(source)
    assert len(reported) == 1


def test_a_missing_root_fails_the_run() -> None:
    assert main(["does_not_exist_anywhere"]) == 1
