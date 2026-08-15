# Features (features/)

- Player-derived query keys must include the exact PUUID; after an explicit
  update, refetch only matching active keys and show the completion message
  only after every refetch succeeds. The shared `["player", puuid]` key stores
  a validated raw `Player` via `playerQueryOptions()` — never an API-result
  envelope.
- The explicit URL PUUID is authoritative for the current tab. Matchmaking
  Analysis uses the global current player only as its initial default, then
  owns a local analyzed-player PUUID that never mutates global context or
  tracking.
- Transient failures belong to the interaction that produced them — clear on
  unmount, on a replacement attempt, and after success; persisted history must
  not rehydrate an old failure into a current-session alert.
- Freshness: use `profile_synced_at` / `league_synced_at` / `match_synced_at`
  per the card's actual source (multi-source identity cards: the oldest
  complete required timestamp); never generic `updated_at`.
- Objective icons are Riot art — never replace them with icon-library
  approximations.
- Smurf & Boost Detection: every specification-fixed string (bands, family
  titles, confidence labels, note readings, disclaimer) comes from
  `smurf-boost/smurf-boost-vocabulary.ts` — never inline one. One band per
  family; never a combined verdict, percentage, 0-100 score, or probability.
- Matchmaking Analysis: seed the active UI from the fast start response,
  rehydrate and poll the exact persisted run, treat rate-limit waits as
  active, cancel by `created_at`, one total ETA on the active card. Persisted
  failures with `error_code=RIOT_API_KEY_INVALID` must activate the shared
  header refresh signal.
