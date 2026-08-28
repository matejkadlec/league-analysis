"""Password hashing for the auth feature.

Argon2id here measures ~42ms per call and the API runs one worker per
container, so every hashing call is offloaded to a thread; done inline it
would stall every other request in flight for that long.
"""

import asyncio
from typing import Protocol

from passlib.context import CryptContext

# passlib has no stubs; `PasswordHasher` below states the contract instead.
# Mirrors `reportMissingTypeStubs = "none"` in pyproject.toml.


class PasswordHasher(Protocol):
    """The slice of passlib's ``CryptContext`` this module depends on."""

    def verify(self, secret: str, hash: str) -> bool:
        """Check a plaintext secret against a stored hash."""
        ...

    def hash(self, secret: str) -> str:
        """Hash a plaintext secret with the configured scheme."""
        ...


# Password hashing context using Argon2id
pwd_context: PasswordHasher = CryptContext(schemes=["argon2"], deprecated="auto")

# Pre-computed Argon2 hash of "dummy_password_for_timing_protection"
DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=65536,t=3,p=4$qNVaS2lNCcH4vzfG+P9fSw$VpLQUmDVmdNQm7w0VIYso0IyglZSf1VDJ7qtaRkmnNQ"


async def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash, off the event loop."""
    return await asyncio.to_thread(pwd_context.verify, plain_password, hashed_password)


async def hash_password(password: str) -> str:
    """Hash a password using Argon2id, off the event loop."""
    return await asyncio.to_thread(pwd_context.hash, password)
