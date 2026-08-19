# Wheel audit — 2026-08-19

Hand-rolled code that an already-installed library or native platform API covers.
Nothing here needs a new dependency except where explicitly flagged.
Ranked by `(lines deleted + tests retired) / risk`.

**Status (2026-08-19, branch `loop/guard-quality-13`): REPLACE items 1-5 and
7-11 are DONE** — the dead raw-dict path is deleted (item 1 grew: the audit's
grep was right and `MatchTransformer` plus `_store_match_detail` went with
`validation.py`), the Intl and zod swaps landed, the `validated*` helpers
gained `params`, `require_env` is gone, and item 4's `useInfiniteQuery`
rework fixed the live 422 with a regression suite. Item 6 (react-hook-form in
`join-us-form.tsx`) was deliberately skipped: it is a rewrite, not a
deletion, and the form just gained an 18-test suite pinning current
behaviour. The PARTIAL and KEEP sections below are still current.

---

## 1. REPLACE — work queue, highest payoff first

### 1. `backend/app/core/validation.py` — delete the whole file (~53 lines + 2 tests)

**Goes:** `validate_nested_fields` (44-62), `validate_list_items` (65-94), their only caller
`MatchTransformer.validate_match_data` (`app/core/riot_api/transformers.py:174-217`), and the
dict pipeline that consumes it, `MatchService._store_match_detail`
(`app/features/matches/service.py:1026-1073`) — which has **zero callers**.

**Why:** pydantic 2.13.4 already validates this exact schema in production.
`MatchDTO(**response)` runs on every live fetch (`riot_api/client.py:604`) and
`store_match_from_dto` (`service.py:1075`) is the real storage path, reached from
`service.py:759`. The validation.py path is a second, unused implementation.

```python
# Production path today — nothing to migrate, just delete the dead twin:
#   match_dto = MatchDTO(**riot_response)                  # client.py:604
#   await match_service.store_match_from_dto(match_dto)    # service.py:1075
# Delete: validate_nested_fields, validate_list_items (validation.py:44-94),
#         MatchTransformer.validate_match_data (transformers.py:174-217),
#         MatchService._store_match_detail (service.py:1026-1073).
# validate_required_fields / is_empty_or_none / _is_json_object / _is_sized_value
# then have zero callers — delete validation.py entirely.
```

**Tests deleted:** `tests/test_transformers.py::test_core_shape_validation_rejects_missing_or_invalid_data`
(39-48) goes entirely. `tests/test_riot_contracts.py::test_raw_match_transformer_keeps_both_timestamp_semantics`
(87-95) loses only its `transformer.validate_match_data(payload)` assertion.

**Risk (1 line):** None if deleted; if someone instead swaps call sites to `MatchDTO.model_validate`,
note the two schema gaps — hand-rolled requires `summonerName` (DTO makes it optional), DTO requires
`gameMode`/`gameType`/`platformId` (hand-rolled never checks them).

---

### 2. `frontend/features/profile/components/champion-stats-card.tsx` (+2 byte-identical dupes) — ~18 lines

**Goes:** `formatWinRate` here, `formatWinRate` in `role-stats-card.tsx:30-35`, `formatPercent`
in `recent-performance-card.tsx:79-84`. All three do `×100` → `% 1 === 0 ? toFixed(0) : toFixed(1)` → `+ "%"`.

```ts
const winRatePercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
// call sites: winRatePercent.format(champ.win_rate) / .format(lane.win_rate) / .format(recent.win_rate)
```
`minimumFractionDigits` defaults to 0, so the trailing `.0` trim happens for free — no branch needed.
Declare the formatter at module level, not per render.

**Tests deleted:** none — grep found no test touching `formatWinRate`/`formatPercent`/these three cards.

**Risk (1 line):** Two divergences, both in Intl's favour and unpinned by tests — `0.5055` → `50.6%`
(Intl, correct) vs `50.5%` (old float artifact), and `0.9999` → `100%` vs `100.0%`.

---

### 3. `frontend/components/toast-host.tsx` — ~17 lines

**Goes:** the hand-rolled `isToastPreviewDetail()` type guard (23-45) and the manual
`ToastPreviewDetail` interface (replaced by `z.infer`).

```ts
import { z } from "zod";

const ToastPreviewDetailSchema = z.object({
  variant: z.enum(["success", "warning", "error", "info"]),
  title: z.string(),
  description: z.string().optional(),
  duration: z.number().finite().positive().optional(),
});

const showPreviewToast = (event: Event) => {
  const parsed = ToastPreviewDetailSchema.safeParse((event as CustomEvent<unknown>).detail);
  if (parsed.success) appToast.toast(parsed.data);
};
```
zod@4.4.3 is installed and is already the pattern for untrusted wire payloads (`lib/core/schemas.ts`).

**Tests deleted:** none — `tests/toast-host.test.tsx` only exercises the valid-payload path; it passes unchanged.

**Risk (1 line):** `.finite()` is load-bearing — `z.number()` alone accepts `Infinity`, silently widening
what's accepted today.

---

### 4. `frontend/features/jobs/components/job-executions.tsx` — ~25 lines, **and fixes a live bug**

**Goes:** the growing `displayCount` state, the `["job-executions-infinite", displayCount]` query key,
and the refetch-everything-from-page-1 behaviour.

**Bug it fixes:** the backend caps `size` at `le=100` (`backend/app/features/jobs/router.py:204`),
so today's growing-size request 422s after the 5th load-more (`size=120`). Fixed page size never does.

```ts
const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useInfiniteQuery({
  queryKey: ["job-executions-infinite"],
  queryFn: async ({ pageParam }) =>
    validatedGet(JobExecutionListResponseSchema, "/jobs/executions/all", { page: pageParam, size: PAGE_SIZE }),
  initialPageParam: 1,
  getNextPageParam: (lastPage, allPages) => {
    const loaded = allPages.reduce((sum, p) => sum + (p.success ? p.data.executions.length : 0), 0);
    const total = lastPage.success ? lastPage.data.total : 0;
    return loaded < total ? allPages.length + 1 : undefined;
  },
  enabled: !!initialExecutions,
  refetchInterval: 15000,
  refetchOnWindowFocus: false,
  refetchOnMount: false,
  refetchOnReconnect: false,
});

const allExecutions = useMemo(
  () => data?.pages.flatMap((p) => (p.success ? p.data.executions : [])) ?? [],
  [data],
);
// observer callback: if (first?.isIntersecting && hasNextPage && !isFetchingNextPage) fetchNextPage();
```

**Tests deleted:** none. `tests/query-key-scope-contract.test.ts` only asserts the literal string
`"job-executions-infinite"` appears as a namespace — still true.

**Risk (1 line):** `refetchInterval` now background-refetches every loaded page (N small requests
instead of one big one) and `isFetchingNextPage` no longer fires during the 15s poll — check the
"Loading more executions..." spinner by hand, nothing pins it.

---

### 5. `frontend/lib/core/relative-time.ts` — ~6 lines

**Goes:** the three `${n} unit${n === 1 ? "" : "s"} ago` templates. The bucket ladder stays —
`Intl.RelativeTimeFormat` takes a unit you must already have chosen; it does no unit selection.

```ts
const rtf = new Intl.RelativeTimeFormat("en-US", { numeric: "always" });

export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "Never";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Never";

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) return "just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) return rtf.format(-elapsedMinutes, "minute");

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return rtf.format(-elapsedHours, "hour");

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return rtf.format(-elapsedDays, "day");

  return new Date(timestamp).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
```
Verified: `format(-1,'minute')` = `"1 minute ago"`, `format(-5,'minute')` = `"5 minutes ago"`,
`format(-23,'hour')` = `"23 hours ago"`, `format(-1,'day')` = `"1 day ago"`. `"just now"` stays hand-written.

**Tests deleted:** none — `frontend/tests/relative-time.test.tsx` pins `"just now"` and `"1 minute ago"`,
both still produced.

**Risk (1 line):** `numeric: "always"` is mandatory — `"auto"` silently turns day=1 into `"yesterday"`,
rippling into `job-card.tsx` and `smurf-boost-detection.tsx` via `useRelativeTime`.

---

### 6. `frontend/features/auth/components/join-us-form.tsx` — ~15 lines

**Goes:** 5 `useState` fields + hand-computed validity flags (50-75) and the manual
`isSubmitting` toggling around the try/catch (83-120).

react-hook-form@7.85.0 is installed and `sign-in-form.tsx` one directory over already uses it with the
same `@/components/ui/form` primitives. `@hookform/resolvers` is **not** installed — use plain RHF
`rules: { required, pattern, validate }`, exactly as `sign-in-form.tsx` does.

```tsx
type JoinUsFormValues = { subject: JoinUsSubject | ""; body: string };

const form = useForm<JoinUsFormValues>({ defaultValues: { subject: "", body: "" } });
const subject = form.watch("subject");
const body = form.watch("body");
const trimmedBody = body.trim();
const bodyLength = trimmedBody.length;
const remainingChars = Math.max(0, MESSAGE_MIN_LENGTH - bodyLength);
const isNoLimitTestSubmission = trimmedBody.toLowerCase().endsWith(NO_LIMIT_TEST_SUFFIX);
const isSubjectValid = subject !== "";
const isBodyValid = isNoLimitTestSubmission || bodyLength >= MESSAGE_MIN_LENGTH;
const isCaptchaSatisfied =
  isNoLimitTestSubmission || !isTurnstileConfigured || (captchaToken !== null && captchaToken.length > 0);
const canSubmit = isSubjectValid && isBodyValid && isCaptchaSatisfied; // watch-based, NOT formState.isValid

const onSubmit = async (data: JoinUsFormValues) => {
  setSubmitError(null);
  try {
    await api.post("/auth/join-us/contact", {
      subject: data.subject as JoinUsSubject,
      body: data.body.trim(),
      captcha_token: captchaToken,
    });
    toast.success("Application sent", { description: "Thank you for reaching out. We will review your message." });
    form.reset();
    setCaptchaToken(null);
    turnstileRef.current?.reset();
  } catch (error) {
    const message = resolveApiErrorMessage(error);
    setSubmitError(message);
    setCaptchaToken(null);
    turnstileRef.current?.reset();
    toast.error("Could not send your application", { description: message });
  }
};

// <Form {...form}><form onSubmit={(e) => void form.handleSubmit(onSubmit)(e)}>
//   <FormField control={form.control} name="subject" rules={{ required: true }} … />
//   <FormField control={form.control} name="body"
//     rules={{ validate: (v) => v.trim().toLowerCase().endsWith(NO_LIMIT_TEST_SUFFIX)
//       || v.trim().length >= MESSAGE_MIN_LENGTH || `Message must be at least ${MESSAGE_MIN_LENGTH} characters.` }} … />
//   <Button type="submit" disabled={form.formState.isSubmitting || !canSubmit}>…</Button>
```
`captchaToken` and `submitError` stay as `useState` — RHF has no slot for an external widget token or a
server-level error banner, matching `sign-in-form.tsx`'s precedent.

**Tests deleted:** none — no test file exists for this component.

**Risk (1 line):** Do **not** gate Submit on `formState.isValid`; RHF hasn't validated on mount, so the
button would start wrongly enabled — derive `canSubmit` from `watch()` as above.

---

### 7. `frontend/features/matches/components/match-row.tsx` — ~5 lines

**Goes:** the hand-written `Today` / `Yesterday` / `${diffDays} days ago` branches in `getDaysAgo`.

```ts
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function getDaysAgo(timestamp: number): string {
  const diffDays = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  const formatted = rtf.format(-diffDays, "day");
  return diffDays < 2 ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : formatted;
}
```
`numeric: "auto"` gives `"today"` / `"yesterday"` / `"2 days ago"` natively; only capitalization differs.

**Tests deleted:** none — `branded-style-contract.test.ts` is a CSS-gradient allowlist, not a behaviour pin.

**Risk (1 line):** Negative `diffDays` (a future `game_start_timestamp`) is unhandled by both versions —
pre-existing, not a regression.

---

### 8. `frontend/features/jobs/components/system-status.tsx` **and** `job-card-format.ts:54-66` — ~4 lines ×2

**Goes:** the abbreviated `${n}m ago` / `${n}h ago` / `${n}d ago` templates, in both copies.
Move them together — this is the same `formatRelativeTime` duplication already logged separately.

```ts
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "always", style: "narrow" });

function formatRelativeTime(timestamp: string): string {
  const diffMins = Math.floor((Date.now() - new Date(timestamp).getTime()) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return rtf.format(-diffMins, "minute");
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return rtf.format(-diffHours, "hour");
  const diffDays = Math.floor(diffHours / 24);
  return rtf.format(-diffDays, "day");
}
```
`style: "narrow"` output is byte-identical: `"5m ago"`, `"1m ago"`, `"23h ago"`, `"3d ago"`.

**Tests deleted:** none — no test references either file's `formatRelativeTime`.

**Risk (1 line):** None material; all values reaching these branches are ≥1, so no zero-value divergence.

---

### 9. `backend/app/core/config.py` — ~8 lines

**Goes:** `require_env()` (203-207) and the five explicit kwargs it feeds `Settings(...)` (209-215).

```python
def get_settings() -> Settings:
    """Get application settings instance."""
    return Settings()
```
`postgres_db/user/password/host/port` are already declared without defaults (29-33) and `model_config`
(192-197) already points `env_file` at `ENV_FILE` — pydantic-settings 2.15.0 resolves and raises on
all missing fields at once.

**Tests deleted:** none exist for `get_settings`/`require_env`.

**Risk (1 line):** Real gap — `require_env` rejects blank-but-present values via `.strip()`, plain
`Settings()` accepts `""` for the str fields; add a `field_validator` (same shape as the existing
`validate_jwt_secret`) if blank must stay rejected.

---

### 10. `frontend/features/matchmaking/matchmaking-api.ts` — ~4 lines (fix the shared helper)

**Goes:** two hand-built `new URLSearchParams(...).toString()` query strings spliced into DELETE URLs.
Root cause is in the shared helper — `validatedDelete` never got the third `params` argument
`validatedGet` has. Fix it there, not at the call sites.

```ts
// lib/core/api.ts
export async function validatedDelete<T>(
  schema: z.ZodType<T>,
  url: string,
  params?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  try {
    const response = await api.delete(url, { params });
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

// features/matchmaking/matchmaking-api.ts
return validatedDelete(
  AnalysisActionResponseSchema,
  `/matchmaking-analysis/player/${puuid}/cancel`,
  { created_at: createdAt },
);
```

**Tests deleted:** none — `tests/matchmaking-analysis-lifecycle.test.tsx` mocks the exported functions
and asserts call arguments, not URLs.

**Risk (1 line):** axios's default serializer and `URLSearchParams` agree for a single flat ISO-string
value; no test asserts on the built URL.

---

### 11. `frontend/features/players/player-api.ts` — ~3 lines (same shared-helper fix, POST side)

**Goes:** `discoverPlayer`'s manual `new URLSearchParams({ ...params })` — whose own comment says it
exists because `validatedPost` lacks a params option. axios's third config arg already does this.

```ts
// lib/core/api.ts
export async function validatedPost<T>(
  schema: z.ZodType<T>,
  url: string,
  data?: unknown,
  params?: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  try {
    const response = await api.post(url, data, { params });
    return validateResponse(schema, url, response.data);
  } catch (error) {
    return { success: false, error: normalizeApiError(error) };
  }
}

// features/players/player-api.ts
export async function discoverPlayer(params: DiscoverPlayerParams): Promise<ApiResponse<Player>> {
  return validatedPost(PlayerSchema, "/players/discover", undefined, params);
}
```

**Tests deleted:** none — consumer tests mock `discoverPlayer`; `e2e/error-copy.spec.ts` checks
`url.pathname`, which excludes the query string.

**Risk (1 line):** Purely additive optional arg — every existing `validatedPost` caller is unaffected.

---

## 2. PARTIAL — library covers part of it; the named gap is what stops a drop-in

### `frontend/features/players/player-card-format.ts` (~4 lines)
The fourth, non-identical `formatWinRate` (21-25). **Gap:** input is dual-scale
(`PlayerLeague.win_rate` arrives 0-100, `MatchStatsResponse.win_rate` arrives 0-1), and this copy
returns a bare number with no `%` — both call sites in `player-card-win-rate.tsx` append `%` themselves.
`Intl.NumberFormat` percent style takes only a 0-1 fraction and always emits its own `%`.

```ts
const winRatePercent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
export function formatWinRate(winRate: number): string {
  const fraction = winRate <= 1 ? winRate : winRate / 100;
  return winRatePercent.format(fraction);
}
// player-card-win-rate.tsx: {formatWinRate(league.win_rate)}  ← drop the trailing literal %
```
**Risk:** both call sites must lose their hardcoded `%` in the same commit or output reads `55%%`.
Easy to miss — it's plain JSX text, not part of the function.

### `frontend/features/smurf-boost/components/smurf-boost-settings-card.tsx` (~20 lines)
RHF could cover `draft`/`parsed`/`errors` and `changed`/`dirty` via `register(name, { valueAsNumber: true,
validate })` + `formState.isDirty`. **Gaps, three:** (a) the suggested zod-schema-via-`@hookform/resolvers`
mechanism is unavailable — that package is not in package.json, package-lock.json or node_modules, so use
plain `validate` callbacks with `getValues()` for the cross-field rule; (b) `SmurfBoostSettingsThresholds`
takes plain `values`/`errors`/`crossError`/`onChange` props, not `register`/`Controller`, so it must be
restructured too; (c) `smurf-boost-settings-presets.tsx` calls `onSelect(...)` straight into
`saveMutation.mutate`, bypassing form state entirely — RHF wouldn't touch it.
**Risk:** scope creep — 3 files, not the ~25 flagged lines. Most of
`tests/smurf-boost-settings-card.test.tsx` (range errors, cross-field `aria-describedby`,
cleared-field-is-not-zero, no-op-edit disables Save) must be re-pointed at `formState.errors`/`isDirty`.
Real rewrite work, not free deletion. **Low priority.**

### `frontend/app/settings/settings-helpers.ts` (~1 line)
`EMAIL_REGEX` → `z.email()`. Already used at `schemas.ts:431`, so the API is proven here.
**Gap:** it is a materially stricter validator, not a refactor — it rejects single-char TLDs (`a@b.c`),
local-part chars outside `[a-z0-9_'+.-]`, leading dots and consecutive dots, all of which the current
regex accepts. A user-visible tightening at "request a change-email code".
**Risk:** needs a product decision, not a swap. 1 line saved — do it only if you want the stricter rule.

### `frontend/lib/core/schemas.ts` (~650 lines, tempting and wrong)
Codegen from the backend's `/openapi.json`. The mechanics check out (`main.py:162-177` exposes it;
69 `response_model=` hits; `riot_api/models.py` is already generated from Riot's spec, so the technique
is established here). **Two gaps block it:** (a) no openapi→zod tool is installed — this is "new dep +
codegen build step", unlike everything else in this report; (b) **the hand-written schema is deliberately
more lenient than the backend's declared contract.** `PlayerBase` declares `summoner_level`/`profile_icon_id`
as required non-null, but `players/models.py` has them `Mapped[int | None]` — and `PlayerSchema:6-10`
marks exactly those `.optional().nullable()`. Codegen would faithfully reproduce the over-strict Pydantic
types and start throwing on real null rows. The `.default(...)` calls and `z.coerce.number()` on id
fields (11, 34, 44-45) are further hand-authored coercion no generator emits.
**Risk:** 44 files import this module. **If you want this, fix `players/schemas.py` to type
`summoner_level`/`profile_icon_id` as `int | None` first**, so the contract matches the DB — that is
worth doing on its own merits regardless of codegen.

---

## 3. KEEP — these wheels earned their place, don't re-audit

- **`backend/app/features/auth/service.py` `_enforce_join_us_regular_rate_limit` (356-392):** slowapi's
  decorator hits the counter *before* the endpoint body, counting attempts not successes — this limiter
  only counts a submission after CAPTCHA passed *and* the email was delivered (`_record_join_us_submission`,
  line 515). It also exempts `#nl` test bodies (needs the parsed Pydantic body, which `exempt_when` can't
  see), returns an exact `Retry-After` from the oldest submission in the window, and is DB-backed, so it
  survives deploys — slowapi here has no `storage_uri` and defaults to in-process `MemoryStorage`.
  The 5 routers slowapi *does* guard are plain per-IP throttles; that's a different shape, not evidence
  this one is redundant.

---

## 4. Best current practice — patterns this audit actually surfaced

**`Intl.RelativeTimeFormat` replaces `${n} unit${n===1?"":"s"} ago`, never the bucket ladder.**
It takes a unit you already chose and does no auto-selection, so the
`seconds<60 → minutes<60 → hours<24 → days<7` ladder in `lib/core/relative-time.ts` stays. Pick the
numeric mode deliberately: `"always"` for `"1 day ago"` (relative-time.ts, system-status.tsx),
`"auto"` for `"yesterday"` (match-row.tsx). `style: "narrow"` gives the `"5m ago"` form byte-for-byte.
`"just now"`/`"Just now"` has no Intl equivalent — keep it hand-written.

**`Intl.NumberFormat({ style: "percent" })` already trims the trailing `.0`.**
Its `minimumFractionDigits` defaults to 0, so `maximumFractionDigits: 1` alone reproduces the
`% 1 === 0 ? toFixed(0) : toFixed(1)` branch in all four `formatWinRate` copies. Declare formatters at
module level — they're expensive to construct and these live in render paths.

**zod v4 for `CustomEvent.detail` and any untrusted payload, matching `lib/core/schemas.ts`.**
`safeParse` + `z.infer` replaces both a hand-rolled type guard and its interface. `z.number()` accepts
`Infinity` — `.finite().positive()` is what preserves `toast-host.tsx`'s current duration rejection.

**`useInfiniteQuery`, not a growing page-size query key.**
`initialPageParam`/`getNextPageParam`/`fetchNextPage`/`hasNextPage`/`isFetchingNextPage` are built for the
IntersectionObserver load-more pattern and keep each request at a fixed size — which is what stops
`job-executions.tsx` from 422ing against the backend's `size` `le=100` cap after 5 load-mores. Note the
tradeoff: `refetchInterval` on an infinite query refetches *every* loaded page each tick.

**react-hook-form without a resolver — `@hookform/resolvers` is not installed.**
`sign-in-form.tsx` is the in-repo precedent: plain `rules: { required, pattern, validate }`. Two traps it
already solves — derive submit-enablement from `watch()`, never `formState.isValid` (RHF hasn't validated
on mount, so the button starts wrongly enabled); and keep external widget tokens (Turnstile) and
server-error banners in `useState`, RHF has no slot for them.

**Fix the shared `lib/core/api.ts` helper, not the caller.**
axios 1.19.0 accepts `config.params` on *every* method. Two call sites hand-build query strings only
because `validatedDelete` and `validatedPost` never got the third `params` argument `validatedGet` has.
Adding it is optional and additive — no existing caller changes.

**pydantic-settings resolves undeclared-default fields itself.**
A `BaseSettings` field with no default is already required; `Settings()` raises a `ValidationError`
listing *all* missing fields at once (and it subclasses `ValueError`, so `except ValueError` still
catches). A per-field `require_env()` helper is a hand-rolled duplicate. Caveat: pydantic accepts `""`
for `str` fields — use a `field_validator` if blank-but-present must be rejected.

**Before "migrate hand-rolled validation to pydantic", check whether pydantic already runs.**
In `validation.py`'s case the DTO path was already the production path and the dict path had zero
callers — the answer was `git rm`, not a migration.
