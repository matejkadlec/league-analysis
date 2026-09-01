"""Coverage for the Riot perks flattening behind `RunesData`."""

from app.features.matches.rune_transform import transform_runes_payload

RIOT_PERKS = {
    "statPerks": {"defense": 5011, "flex": 5008, "offense": 5005},
    "styles": [
        {
            "description": "primaryStyle",
            "style": 8200,
            "selections": [
                {"perk": 8214, "var1": 1400, "var2": 0, "var3": 0},
                {"perk": 8226, "var1": 250, "var2": 0, "var3": 0},
                {"perk": 8210, "var1": 6, "var2": 0, "var3": 0},
                {"perk": 8237, "var1": 700, "var2": 0, "var3": 0},
            ],
        },
        {
            "description": "subStyle",
            "style": 8300,
            "selections": [
                {"perk": 8345, "var1": 3, "var2": 0, "var3": 0},
                {"perk": 8347, "var1": 0, "var2": 0, "var3": 0},
            ],
        },
    ],
}


def test_flattening_keeps_only_what_the_match_row_renders() -> None:
    # The column stores Riot's whole perks tree; the response carries the
    # three values `match-row-icons.tsx` draws icons from and nothing else.
    assert transform_runes_payload(RIOT_PERKS) == {
        "primary_style": 8200,
        "sub_style": 8300,
        "keystone": 8214,
    }


def test_keystone_is_the_first_primary_selection_not_any_perk() -> None:
    reordered = {
        "styles": [
            {
                "description": "primaryStyle",
                "style": 8200,
                "selections": [{"perk": 8226}, {"perk": 8214}],
            }
        ]
    }

    assert transform_runes_payload(reordered)["keystone"] == 8226  # type: ignore[index]


def test_primary_style_without_selections_yields_no_keystone() -> None:
    empty = {"styles": [{"description": "primaryStyle", "style": 8200}]}

    assert transform_runes_payload(empty) == {
        "primary_style": 8200,
        "sub_style": None,
        "keystone": None,
    }


def test_already_flattened_rows_pass_straight_through() -> None:
    # Re-validating a `RunesData` dump must not be mistaken for a Riot payload.
    flattened = {"primary_style": 8200, "sub_style": 8300, "keystone": 8214}

    assert transform_runes_payload(flattened) is flattened


def test_perks_without_styles_is_not_runes_data() -> None:
    # Riot returned this shape for at least one stored match.
    assert transform_runes_payload({"statPerks": {}}) is None
    assert transform_runes_payload(None) is None
