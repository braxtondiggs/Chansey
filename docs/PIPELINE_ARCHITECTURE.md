# Pipeline & Backtest Architecture

This document describes the two backtest pipelines in Chansey and how they work.

## 1. Strategy Validation Pipeline (Full Pipeline)

The multi-stage validation flow that takes a strategy from optimization to deployment recommendation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    STRATEGY VALIDATION PIPELINE                             │
│                                                                             │
│  User + StrategyConfig + Risk Level (1-5)                                  │
│                         │                                                   │
│                         ▼                                                   │
│  ┌─────────────────────────────────────┐                                   │
│  │         1. OPTIMIZE                  │  Grid/random search over params   │
│  │  OptimizationOrchestratorService     │  Walk-forward analysis            │
│  │                                      │  Returns best parameters          │
│  └──────────────┬──────────────────────┘                                   │
│                 │ Gate: minImprovement ≥ 3%                                 │
│                 ▼                                                           │
│  ┌─────────────────────────────────────┐                                   │
│  │         2. HISTORICAL                │  Backtest (type=HISTORICAL)       │
│  │  BacktestProcessor (historicalQueue) │  Older date ranges                │
│  │                                      │  Uses optimized params            │
│  └──────────────┬──────────────────────┘                                   │
│                 │ Gate: Must generate ≥ 1 trade                            │
│                 ▼                                                           │
│  ┌─────────────────────────────────────┐                                   │
│  │         3. LIVE_REPLAY               │  Backtest (type=LIVE_REPLAY)      │
│  │  LiveReplayProcessor (replayQueue)   │  Recent data, adjustable pacing   │
│  │                                      │  Can pause/resume                 │
│  └──────────────┬──────────────────────┘                                   │
│                 │ Gate: Composite Score ≥ 30/100                           │
│                 │ (Sharpe + returns + drawdown + degradation + regime)      │
│                 ▼                                                           │
│  ┌─────────────────────────────────────┐                                   │
│  │         4. PAPER_TRADE               │  PaperTradingSession              │
│  │  PaperTradingEngineService           │  Real-time signal execution       │
│  │                                      │  Exit tracking (SL/TP/trailing)   │
│  └──────────────┬──────────────────────┘                                   │
│                 │ Gate: Sharpe ≥ 0.3, Drawdown ≤ 45%, Return ≥ 0          │
│                 ▼                                                           │
│  ┌─────────────────────────────────────┐                                   │
│  │         5. COMPLETED                 │  PipelineSummaryReport            │
│  │  PipelineReportService               │  Recommendation:                  │
│  │                                      │  - DEPLOY                         │
│  │                                      │  - NEEDS_REVIEW                   │
│  │                                      │  - DO_NOT_DEPLOY                  │
│  └─────────────────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Risk-Based Configuration

Risk level (1-5) drives all stage thresholds:

| Risk Level       | Paper Trading | Training Period | Max Drawdown |
| ---------------- | ------------- | --------------- | ------------ |
| 1 (Conservative) | 14 days       | 180 days        | 15%          |
| 3 (Moderate)     | 7 days        | 90 days         | 25%          |
| 5 (Aggressive)   | 3 days        | 30 days         | 40%          |

## 2. Standalone Backtest Pipeline (Direct Execution)

Users can run backtests directly without the full pipeline for ad-hoc analysis:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      STANDALONE BACKTESTS                                    │
│                                                                             │
│  User + Algorithm + Market Data + Params                                   │
│                         │                                                   │
│              ┌──────────┴──────────┐                                       │
│              ▼                      ▼                                       │
│  ┌──────────────────┐   ┌──────────────────────┐                           │
│  │    HISTORICAL     │   │    LIVE_REPLAY        │                          │
│  │                   │   │                       │                          │
│  │  historicalQueue  │   │  replayQueue          │                          │
│  │  (BullMQ)        │   │  (BullMQ)             │                          │
│  │                   │   │                       │                          │
│  │  Old date range   │   │  Recent data          │                          │
│  │  Runs to          │   │  Adjustable speed     │                          │
│  │  completion       │   │  Pause/resume         │                          │
│  └────────┬─────────┘   └──────────┬────────────┘                          │
│           │                         │                                       │
│           └──────────┬──────────────┘                                       │
│                      ▼                                                      │
│           ┌─────────────────────┐                                          │
│           │  BacktestEngine      │  Shared simulation engine               │
│           │  - Runs algorithm    │  - Generates trades                     │
│           │  - Calculates metrics│  - Snapshots performance                │
│           │  - Checkpoint/resume │  - Produces signals                     │
│           └─────────────────────┘                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Entity Relationships

```
Pipeline ─────────────┬── OptimizationRun        (Stage 1)
  │                   ├── Backtest (HISTORICAL)   (Stage 2)
  │                   ├── Backtest (LIVE_REPLAY)  (Stage 3)
  │                   └── PaperTradingSession     (Stage 4)
  │
  ├── user: User              (FK, cascade delete)
  ├── strategyConfig           (what to test)
  ├── stageConfig              (risk-based thresholds)
  ├── stageResults             (JSON per stage)
  └── pipelineScore / grade    (A-F, set at LIVE_REPLAY gate)

Backtest ─────────────┬── BacktestTrade[]
  │                   ├── BacktestPerformanceSnapshot[]
  │                   ├── BacktestSignal[]
  │                   ├── SimulatedOrderFill[]
  │                   └── checkpointState        (for resume)
  │
  ├── type: HISTORICAL | LIVE_REPLAY | PAPER_TRADING | STRATEGY_OPTIMIZATION
  └── status: PENDING → RUNNING → COMPLETED/FAILED/PAUSED/CANCELLED
```

## Event-Driven Stage Progression

```
optimization.completed ──→ Evaluate gate ──→ Start HISTORICAL backtest
backtest.completed     ──→ Evaluate gate ──→ Start next stage (LIVE_REPLAY or PAPER_TRADE)
paper-trading.completed──→ Generate report ──→ COMPLETED with recommendation
        │
        └── Any failure ──→ Pipeline FAILED (no retry, user must restart)
```

## Key Services

| Service                         | Responsibility                                                   |
| ------------------------------- | ---------------------------------------------------------------- |
| PipelineOrchestratorService     | Master orchestrator; routes stage execution; manages transitions |
| OptimizationOrchestratorService | Parameter optimization with walk-forward analysis                |
| BacktestService                 | Creates/manages backtest records; queues execution               |
| BacktestProcessor               | BullMQ processor for HISTORICAL backtests                        |
| LiveReplayProcessor             | BullMQ processor for LIVE_REPLAY backtests (with pause/resume)   |
| PaperTradingService             | Creates/manages paper trading sessions                           |
| PaperTradingEngineService       | Executes paper trading signals in real-time                      |
| BacktestEngine                  | Core simulation engine for both backtest types                   |
| ScoringService                  | Calculates composite pipeline score at LIVE_REPLAY gate          |
| PipelineReportService           | Generates final summary report with deployment recommendation    |

## Key Difference

The **full pipeline** is an automated, gated progression that validates a strategy across increasingly realistic
conditions before recommending deployment. **Standalone backtests** are one-shot simulations for ad-hoc analysis without
gates or progression.
