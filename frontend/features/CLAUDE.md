# Features (features/)

- Player-derived query keys must include the exact PUUID, and after an
  explicit update refetch only matching active keys — show the completion
  message only once every refetch has succeeded.
- Freshness: use `profile_synced_at` / `league_synced_at` / `match_synced_at`
  per the card's actual source (multi-source identity cards: the oldest
  complete required timestamp); never generic `updated_at`.
- Objective icons are Riot art — never replace them with icon-library
  approximations.
