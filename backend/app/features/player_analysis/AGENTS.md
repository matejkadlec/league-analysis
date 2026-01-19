# Player Analysis Feature (`features/player_analysis/`)

Multi-factor analysis to detect smurf accounts. **Unique architecture** - has modular analyzers.

## Structure

```
player_analysis/
├── __init__.py
├── router.py
├── service.py              # Orchestrates analyzers, calculates weighted scores
├── models.py               # PlayerAnalysis model
├── schemas.py
├── dependencies.py
├── config.py               # Factor weights and thresholds
└── analyzers/              # Modular factor analyzers
    ├── __init__.py
    ├── win_rate.py
    ├── account_level.py
    ├── performance.py
    ├── rank_progression.py
    └── ... (9 total analyzers)
```

## Detection Algorithm

9-factor analysis with weighted scoring:

1. **Rank Discrepancy** (20%) - Performance vs current rank
2. **Win Rate Analysis** (18%) - Sustained high win rates
3. **Performance Trends** (15%) - KDA patterns
4. **Win Rate Trends** (10%) - Rapid win rate improvement
5. **Role Performance** (9%) - Multi-role versatility
6. **Rank Progression** (9%) - Fast rank climbing
7. **Account Level** (8%) - Low level + high performance
8. **Performance Consistency** (8%) - Low variance
9. **KDA Analysis** (3%) - Exceptional K/D/A ratios

**Final score**: `Σ(factor_score × factor_weight)`

**Confidence levels**:

- **High (80%+)**: Very likely smurf
- **Medium (60-79%)**: Probable smurf
- **Low (40-59%)**: Possible smurf
- **< 40%**: Unlikely smurf

## How It Works

```python
# Service orchestrates analyzers
service = PlayerAnalysisService(riot_data_manager)
result = await service.analyze_player(puuid, platform, db)

# Each analyzer evaluates its factor
for analyzer in self.analyzers:
    factor_score = await analyzer.analyze(player_data)
    factor_scores.append(factor_score)

# Weighted sum produces final score
final_score = sum(score * weight for score, weight in factor_scores)

# Store result
detection = PlayerAnalysis(
    player_id=player.id,
    overall_score=final_score,
    factor_scores=factor_scores
)
```

## Analyzer Pattern

Each analyzer implements similar interface (not strictly enforced):

```python
class MyAnalyzer:
    async def analyze(self, player_data) -> float:
        # Return score 0.0-1.0
        return score
```

Configuration in `config.py` defines weights and thresholds for each analyzer.
