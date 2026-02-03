# Profile Feature

## Purpose

Components for the My Profile page displaying user's own League of Legends statistics.

## Components

### ChampionStatsCard

Displays top played champions with:

- Champion icon (from Data Dragon)
- Games played
- KDA (Kills/Deaths/Assists)
- Win rate (color coded: green >55%, yellow 50-55%, red <50%)
- Updated timestamp

### RoleStatsCard

Displays performance by role/position:

- Role icon (emoji)
- Games played
- KDA
- Win rate
- Visual play rate bar
- Updated timestamp

### RecentPerformanceCard

Compares recent performance (last 10 games) vs overall:

- Win rate comparison (recent vs overall)
- Main role win rate comparison
- Average KDA comparison
- Average Kills, Deaths, Assists comparison
- Average CS comparison
- Average Vision comparison
- Updated timestamp

All comparisons show trend indicators (improving/declining/stable).

## Backend Endpoints Used

- `GET /matches/player/{puuid}/champion-stats?queue=420&limit=20`
- `GET /matches/player/{puuid}/lane-stats?queue=420`
- `GET /matches/player/{puuid}/stats?queue=420&limit=10` (recent)
- `GET /matches/player/{puuid}/stats?queue=420` (overall)

## Dependencies

- Data Dragon for champion icons (`getChampionIconUrl`)
- TanStack Query for data fetching
- shadcn/ui components (Card, Badge, Skeleton)
