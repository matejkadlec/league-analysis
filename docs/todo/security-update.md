# Security Update

This document tracks known security flaws and planned improvements for the League Analysis authentication.

## Authentication & Security

### Refresh Tokens

**Priority:** High
**Status:** ✅ Completed (2026-02-09)
**Description:** Implement refresh token mechanism for long-lived sessions without compromising security.

**Implemented State:**

- Access tokens are short-lived (`JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, default `30`)
- Refresh tokens are persisted in `auth.refresh_tokens` and rotated on `/auth/refresh`
- Refresh tokens are one-time use; reuse attempts trigger session revocation

**Implementation Details:**

- New endpoint: `POST /api/v1/auth/refresh`
- Login now returns both access + refresh token pair
- Refresh rotates token and returns a brand new pair
- Logout revokes all active refresh tokens for current user

**Code Locations:**

- `backend/app/features/auth/service.py`
- `backend/app/features/auth/router.py`
- `backend/app/features/auth/refresh_token.py`
- `backend/init_database.sql`

**References:**

- [OAuth 2.0 Refresh Tokens](https://oauth.net/2/refresh-tokens/)
- [JWT Best Practices - Refresh Tokens](https://auth0.com/blog/refresh-tokens-what-are-they-and-when-to-use-them/)

---

### JWT Token Revocation / Blacklisting

**Priority:** High
**Status:** ✅ Completed (2026-02-09)
**Description:** Implement token revocation mechanism to invalidate JWTs before expiration.

**Implemented State:**

- Access tokens include `jti` claim
- Revoked access tokens are persisted in `auth.revoked_access_tokens`
- Auth middleware path checks blacklist in `get_current_user`
- Logout revokes current access token + all active refresh sessions

**Implementation Details:**

- Revocation table stores token ID and expiration time
- Expired revocation/refresh rows are cleaned up opportunistically during auth flows

**Code Locations:**

- `backend/app/features/auth/revoked_access_token.py`
- `backend/app/features/auth/service.py`
- `backend/init_database.sql`

---

### Account Lockout Mechanism

**Priority:** Medium
**Status:** ✅ Completed (2026-02-09)
**Description:** Implement account lockout after multiple failed login attempts to prevent brute force attacks.

**Implemented State:**

- Rate limiting implemented (5 login attempts/minute per IP)
- Per-account failed login counters stored in `auth.users`
- Temporary lockout after configurable failure threshold
- Lockout metadata automatically reset on successful login

**Implementation Details:**

- Added columns:
  - `failed_login_attempts`
  - `last_failed_login`
  - `locked_until`
- Login protection rules:
  - Lock account after `AUTH_LOCKOUT_MAX_ATTEMPTS` failures (default `5`)
  - Lock duration controlled by `AUTH_LOCKOUT_MINUTES` (default `15`)
  - Clear lock metadata after successful login or when lock expires
- Backend returns structured error code `ACCOUNT_LOCKED` with `locked_until` timestamp.

**Code Locations:**

- `backend/app/features/auth/service.py`
- `backend/app/features/auth/router.py`
- `backend/app/features/auth/models.py`
- `backend/init_database.sql`

---

### Adaptive CAPTCHA on Sign-In

**Priority:** Medium
**Status:** ✅ Completed (2026-02-09)
**Description:** Require CAPTCHA only after suspicious/repeated failed login attempts to reduce brute-force risk without adding friction to normal logins.

**Implemented State:**

- Cloudflare Turnstile integrated into sign-in flow
- CAPTCHA not shown by default
- CAPTCHA required only after configurable failed-attempt threshold
- Backend verifies Turnstile token server-side using secret key

**Configuration:**

- Backend:
  - `TURNSTILE_SECRET_KEY`
  - `TURNSTILE_SITEVERIFY_URL` (optional override)
  - `AUTH_CAPTCHA_AFTER_FAILURES` (default `2`)
- Frontend:
  - `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

**Code Locations:**

- `frontend/features/auth/components/sign-in-form.tsx`
- `frontend/features/auth/context/auth-context.tsx`
- `backend/app/features/auth/service.py`
- `backend/app/features/auth/router.py`

---

### JWT Secret Key Validation

**Priority:** High
**Status:** ✅ Completed
**Description:** Implement runtime validation for JWT secret key in production.

**Implemented State:**

- Runtime validation is enforced in `backend/app/core/config.py`
- Production deployments fail fast on weak/default JWT secrets
- Minimum recommended secret length is enforced (32+ chars)

**Research Findings (2025):**

**Secret Generation Methods:**

1. **Python secrets module** (Recommended):

   ```python
   import secrets
   secret_key = secrets.token_hex(32)  # 256-bit key
   # or
   secret_key = secrets.token_urlsafe(32)
   ```

2. **OpenSSL command**:

   ```bash
   openssl rand -hex 32
   ```

3. **NEVER use**:
   - `random` module (not cryptographically secure)
   - UUIDs (not cryptographically secure)

**Security Best Practices:**

- Rotate keys every 3-6 months, or immediately after security incident
- Consider RS256 (asymmetric) instead of HS256 for better security
- Never commit keys to version control
- Always use environment variables for production

**Proposed Implementation:**

1. Add startup validation in `backend/app/main.py`:

   ```python
   if settings.environment == "production":
       if "dev_secret" in settings.jwt_secret_key.lower():
           raise ValueError("Production JWT secret must be changed!")
       if len(settings.jwt_secret_key) < 32:
           raise ValueError("JWT secret must be at least 32 characters!")
   ```

2. Document secret generation in deployment docs:
   - Add instructions to generate secret using `secrets.token_hex(32)`
   - Recommend Docker secrets integration for containerized deployments
   - Document AWS Secrets Manager / Azure Key Vault integration
   - Add key rotation procedures

**References:**

- [Secure JWT Key Generation 2025](https://theriturajps.github.io/blog/generate-jwt-secret-keys-secure-2025)
- [Auth0: JWT Handling in Python](https://auth0.com/blog/how-to-handle-jwt-in-python/)
- [FastAPI OAuth2 JWT Tutorial](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)

---

## Secrets Management

This section contains optional production-grade approaches and is currently not required for local WSL deployment.

---

### External Secrets Managers (Advanced)

**Priority:** Medium
**Status:** Future Enhancement
**Description:** Integrate with external secrets management service for production-grade security.

**When Needed:**

- Deploying at scale (multiple servers)
- Handling sensitive PII or payment data
- Regulatory compliance requirements (SOC 2, HIPAA, etc.)
- Need for audit trails and access logs
- Automatic secret rotation

**Options:**

**1. Docker Swarm Secrets** (if using Swarm orchestration)

- Built into Docker Swarm mode
- Fully encrypted at rest and in transit
- Mounted in `/run/secrets/` as tmpfs (never written to disk)
- Automatic distribution across Swarm cluster
- **Limitation**: Requires enabling Swarm mode

**2. HashiCorp Vault**

- Self-hosted or cloud
- Dynamic secrets with automatic rotation
- Fine-grained access control
- Full audit logging
- Supports multiple authentication backends
- **Complexity**: Requires separate infrastructure

**3. Cloud Provider Secrets**

- **AWS Secrets Manager**: Automatic rotation, tight IAM integration
- **Azure Key Vault**: Integration with Azure services
- **Google Secret Manager**: Integration with GCP services
- **Pros**: Managed service, no infrastructure to maintain
- **Cons**: Vendor lock-in, additional cost

**Implementation Considerations:**

- Add Python client library (boto3 for AWS, azure-keyvault for Azure, etc.)
- Update `Settings` class to fetch secrets on startup
- Implement caching to avoid API calls on every request
- Handle secret rotation gracefully (watch for updates)
- Consider using application-side secret caching with TTL

**Example (AWS Secrets Manager):**

```python
import boto3
from botocore.exceptions import ClientError

def get_secret_from_aws(secret_name: str) -> str:
    """Fetch secret from AWS Secrets Manager."""
    client = boto3.client('secretsmanager', region_name='us-east-1')
    try:
        response = client.get_secret_value(SecretId=secret_name)
        return response['SecretString']
    except ClientError as e:
        raise RuntimeError(f"Failed to fetch secret: {e}")
```

---

### Database Credentials Migration

**Priority:** High
**Status:** Planned
**Description:** Move database credentials (POSTGRES_PASSWORD, POSTGRES_USER) from environment variables to Docker secrets.

**Current State:**

- Database credentials in `.env` file and passed via environment variables
- Exposed to all processes in containers
- Visible via `docker inspect`

**Proposed Solution:**

1. **Phase 1**: Move to file-based Docker Compose secrets (Tier 2)
   - Store `POSTGRES_PASSWORD` in `secrets/postgres_password.txt`
   - Update compose files to use secrets
   - Update PostgreSQL container to read from `/run/secrets/`
2. **Phase 2**: Consider external secrets manager (Tier 3) if needed

**Database Container Support:**
PostgreSQL official image supports reading secrets from files:

```yaml
services:
  postgres:
    secrets:
      - postgres_password
    environment:
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
```

**Backend Application:**
Update connection string construction to read from secret file:

```python
def get_database_url(self) -> str:
    """Construct database URL with secrets from files."""
    password_file = os.getenv("POSTGRES_PASSWORD_FILE")
    if password_file and os.path.exists(password_file):
        with open(password_file) as f:
            password = f.read().strip()
    else:
        password = self.postgres_password

    return f"postgresql+asyncpg://{self.postgres_user}:{password}@postgres:5432/{self.postgres_db}"
```

---

### Deprecate Riot API Key from Environment Variables

**Priority:** Medium
**Status:** ✅ Completed (2025-10-26)
**Description:** Removed Riot API key from `.env` file; now uses database-only storage.

**Implementation Details:**

- Removed `riot_api_key` field from `Settings` class in `backend/app/core/config.py`
- `get_riot_api_key(db)` function now retrieves from database only
- Updated all documentation to reflect database-only storage
- Removed `RIOT_API_KEY` from `.env.example`

**Rationale for Database-Only Storage:**

1. **Runtime Updates**: API keys can be updated via web UI without redeployment
2. **Key Rotation**: Easy to rotate keys without container restarts
3. **No .env Dependency**: Reduces reliance on environment variables
4. **Centralized Management**: Single source of truth for API key
5. **Development Keys Expire**: Riot development keys expire every 24 hours, need frequent updates

**What Was Changed:**

1. **Backend Configuration** (`backend/app/core/config.py`):

   - Removed `riot_api_key` field from `Settings` class
   - `get_riot_api_key(db)` function retrieves from database only
   - Raises clear error if API key not configured in database

2. **Documentation Updates**:

   - Removed `RIOT_API_KEY` from `.env.example`
   - Updated `README.md` setup instructions
   - Updated `docker/AGENTS.md` environment variables section
   - Updated `docs/guides/deployment.md` secrets section
   - Updated `backend/README.md` key variables list
   - Updated `backend/app/core/AGENTS.md` configuration docs

3. **User Experience**:
   - API key set via web UI at `/settings` page
   - Startup logs warn if API key not configured
   - Clear error messages guide users to settings page

**Benefits Achieved:**

- ✅ Single source of truth for API key (database)
- ✅ Runtime key updates without container restarts
- ✅ No sensitive data in `.env` files
- ✅ Simpler deployment process
- ✅ Supports 24-hour dev key rotation workflow

**Migration for Existing Users:**

Users with API key in `.env` should:

1. Set API key via web UI at `/settings`
2. Remove `RIOT_API_KEY` line from `.env`
3. Restart services

---

## Frontend

### CSRF Protection

**Priority:** Medium
**Status:** ✅ Completed (2026-02-09)
**Description:** Implement CSRF protection for state-changing operations.

**Implemented State:**

- Chosen model: localStorage-only auth token storage
- Removed auth cookie synchronization from frontend token manager
- Removed cookie-based auth routing check in Next middleware
- CSRF risk from browser cookie auth is eliminated for API calls using bearer tokens

**Code Locations:**

- `frontend/features/auth/utils/token-manager.ts`
- `frontend/features/auth/context/auth-context.tsx`
- `frontend/middleware.ts`

---

### Password Hash Column Size

**Status:** Completed
**Description:** Changed `auth.users.password_hash` from `String(255)` to `Text` type to future-proof against longer Argon2 hashes with different parameters.

**Migration:** See Alembic migration `XXX_change_password_hash_to_text.py`

---

## Performance

_No current performance-related technical debt items._

---

## Testing

_No current testing-related technical debt items._

---

## Documentation

### Admin User Management

**Status:** Completed
**Description:** Created unified `backend/scripts/manage_admin.py` to manage admin user accounts.

**Usage:**

```bash
# Create a new admin user
docker compose exec backend uv run python scripts/manage_admin.py create

# Reset an existing admin user's password
docker compose exec backend uv run python scripts/manage_admin.py reset
```

---

## Contributing to This Document

When adding technical debt items:

1. Use clear, descriptive headings
2. Include priority level (High/Medium/Low)
3. Document current state and proposed solution
4. Reference relevant code locations
5. Link to external resources when helpful
6. Update status as work progresses
7. Move completed items to bottom with "Completed" status

**Priority Levels:**

- **High:** Security risks, data integrity issues, or major performance problems
- **Medium:** Quality of life improvements, moderate security enhancements
- **Low:** Nice-to-have features, minor refactoring opportunities
