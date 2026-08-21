"""Argon2 must not run on the event loop.

The parameters this repo configures measure ~42ms per call, and the API runs
one worker per container, so an inline hash stalls every other request in
flight for that long -- including the dummy-hash branch a failed login takes
precisely so that timing says nothing about whether the account exists.

Asserting `asyncio.to_thread` was called would only restate the
implementation. This asserts the property that matters: the loop kept
running while the hash ran.
"""

import asyncio
import warnings

from app.features.auth.passwords import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    pwd_context,
    verify_password,
)

with warnings.catch_warnings():
    # Warming passlib's argon2 backend here keeps its deprecated
    # argon2.__version__ probe from firing inside warnings-as-error tests.
    warnings.simplefilter("ignore", DeprecationWarning)
    _ = pwd_context.verify("warm-up-probe", DUMMY_PASSWORD_HASH)


async def _count_loop_iterations(counter: list[int]) -> None:
    while True:
        counter[0] += 1
        await asyncio.sleep(0)


async def test_verifying_a_password_leaves_the_loop_free() -> None:
    counter = [0]
    ticker = asyncio.create_task(_count_loop_iterations(counter))

    verified = await verify_password("wrong-password", DUMMY_PASSWORD_HASH)

    ticker.cancel()
    assert verified is False
    assert counter[0] > 0, "the event loop never ran while Argon2 did"


async def test_hashing_a_password_leaves_the_loop_free() -> None:
    counter = [0]
    ticker = asyncio.create_task(_count_loop_iterations(counter))

    hashed = await hash_password("some-password")

    ticker.cancel()
    assert hashed.startswith("$argon2id$")
    assert counter[0] > 0, "the event loop never ran while Argon2 did"
