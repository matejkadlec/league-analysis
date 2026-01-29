# Playstyle Analysis Feature

**Purpose**: Displays deep analysis of player behavior, including role preferences, playstyle tags (Aggressive, Farmer, etc.), and summary statistics (CS/min, vision score, etc.).

## Components

- `playstyle-analysis.tsx`: Main component that fetches and displays the analysis data.
  - specific for `puuid`
  - displays "Tags" (OTP, Diver, etc.)
  - displays "Summary Stats" (Radar chart or list)

## Integration

- **API**: GET `/playstyle-analysis/player/{puuid}/latest` to get `PlaystyleAnalysis` object.
- **Trigger**: GET `/playstyle-analysis/player/{puuid}/exists` to check if analysis exists.
- **Mutation**: POST `/playstyle-analysis/analyze` to trigger new analysis.

## Schemas

- `PlaystyleAnalysisResponseSchema`: The main data contract.
- `PlaystyleTagSchema`: Structure for tags.

## Usage

Import from `@/features/playstyle-analysis`.

```tsx
import { PlaystyleAnalysis } from "@/features/playstyle-analysis";

<PlaystyleAnalysis puuid={currentPuuid} />;
```
