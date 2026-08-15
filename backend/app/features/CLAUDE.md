# Backend features (app/features/)

- Player records, matches, and freshness timestamps are shared by PUUID;
  current selection, tracked mappings, and recent ordering are scoped by
  authenticated application user ID. Never infer one from the other.
