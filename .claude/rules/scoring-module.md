---
description: Strategy scoring with walk-forward analysis and promotion criteria
globs:
  - "apps/api/src/scoring/**"
---

# Scoring Module

## Overview

11 files. Strategy scoring with walk-forward analysis (WFA).

## Default Weights (must sum to 1.0)

| Component | Weight | Notes |
|-----------|--------|-------|
| sharpe | 0.25 | |
| wfaDegradation | 0.20 | Heaviest — anti-overfitting |
| calmar | 0.15 | |
| winRate | 0.10 | |
| profitFactor | 0.10 | |
| stability | 0.10 | |
| correlation | 0.10 | |

Also available: `CONSERVATIVE_WEIGHTS`, `AGGRESSIVE_WEIGHTS`.

## ScoringService

- `calculateScore()`: components → weighted score → SQL percentile → grade → promotion eligibility → warnings
- `calculateScoreFromMetrics()`: in-memory only, used in backtest pipeline. `marketRegime` modifier (+15 extreme, -5 low vol)

## Promotion Criteria

Score ≥ 70, trades ≥ 30, maxDrawdown ≤ 40%, wfaDegradation ≤ 30%, totalReturn > 0.

## Calculators

4 local: Calmar, WinRate, ProfitFactor, Stability. Also imports 3 from `common/metrics/`.

## Walk-Forward Analysis

`WalkForwardService` (rolling or anchored). 3 presets:

| Preset | Train/Test/Step (days) |
|--------|------------------------|
| DEFAULT | 180 / 90 / 30 |
| AGGRESSIVE | 365 / 90 / 30 |
| FAST | 90 / 30 / 15 |

## WindowProcessor

Degradation = Sharpe(0.5) + return(0.3) + profitFactor(0.2). Overfitting flags at >30% degradation.

## DegradationCalculator

6 metrics weighted: Sharpe 0.30, return 0.25, winRate 0.15, profitFactor 0.15, drawdown 0.10, vol 0.05.

## Gotcha

Correlation defaults to 100 — updated lazily when comparing with other strategies.
