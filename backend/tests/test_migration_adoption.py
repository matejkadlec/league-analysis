"""Migration-adoption revision consistency regression coverage."""

from scripts import adopt_migrations, validate_migrations


def test_adoption_stamp_expectation_matches_the_validated_head() -> None:
    """A successful `stamp head` must satisfy the adoption postcondition."""
    assert adopt_migrations.EXPECTED_REVISION == validate_migrations.EXPECTED_REVISION
