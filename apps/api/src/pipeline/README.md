# Strategy Development Pipeline Module

The Pipeline module automates strategy validation through a multi-stage process, ensuring trading strategies are rigorously tested before deployment.

## Overview

The Strategy Development Pipeline validates trading strategies through four sequential stages:

```
┌────────────────┐    ┌────────────────┐    ┌────────────────┐    ┌────────────────┐
│   OPTIMIZE     │───▶│   HISTORICAL   │───▶│  LIVE_REPLAY   │───▶│  PAPER_TRADE   │
│                │    │                │    │                │    │                │
│ Walk-forward   │    │ Full backtest  │    │ Real-time      │    │ Live market    │
│ optimization   │    │ on historical  │    │ replay with    │    │ simulation     │
│                │    │ data           │    │ pacing         │    │                │
└────────────────┘    └────────────────┘    └────────────────┘    └────────────────┘
        │                     │                     │                     │
        ▼                     ▼                     ▼                     ▼
   min 5% improvement    Sharpe ≥ 1.0         Sharpe ≥ 0.8         Sharpe ≥ 0.7
                         Drawdown ≤ 25%       Drawdown ≤ 30%       Drawdown ≤ 35%
                         Win Rate ≥ 45%       Degradation ≤ 20%    Return ≥ 0%
```

## Architecture

### Module Structure

```
pipeline/
├── dto/                          # Data Transfer Objects
│   ├── index.ts
│   └── pipeline-filters.dto.ts
├── entities/
│   └── pipeline.entity.ts        # TypeORM entity
├── interfaces/
│   ├── index.ts
│   ├── pipeline-config.interface.ts    # Configuration types
│   ├── pipeline-events.interface.ts    # Event definitions
│   └── stage-results.interface.ts      # Result types
├── listeners/
│   └── pipeline-event.listener.ts      # Event handlers
├── processors/
│   └── pipeline.processor.ts           # BullMQ job processor
├── services/
│   ├── pipeline-orchestrator.service.ts  # Main orchestration logic
│   └── pipeline-report.service.ts        # Report generation
├── pipeline.config.ts            # Module configuration
├── pipeline.controller.ts        # REST API endpoints
├── pipeline.module.ts            # NestJS module definition
└── README.md                     # This file
```

### Key Components

| Component | Responsibility |
|-----------|---------------|
| `PipelineOrchestratorService` | Core orchestration logic, stage management, event handling |
| `PipelineProcessor` | BullMQ worker for async stage execution |
| `PipelineReportService` | Summary report generation and analysis |
| `PipelineEventListener` | Listens for events from other modules (optimization, backtest, paper trading) |
| `PipelineController` | REST API endpoints for pipeline management |

## Pipeline Stages

### 1. Optimization Stage (`OPTIMIZE`)

Runs walk-forward optimization to find optimal strategy parameters.

**Configuration:**
- `trainDays`: Training window size (default: 90 days)
- `testDays`: Testing window size (default: 30 days)
- `stepDays`: Rolling window step (default: 14 days)
- `objectiveMetric`: Optimization target (`sharpe_ratio`, `total_return`, `sortino_ratio`)
- `maxCombinations`: Maximum parameter combinations to test
- `earlyStop`: Enable early stopping for efficiency

**Progression Threshold:**
- Minimum 5% improvement over baseline required

### 2. Historical Backtest Stage (`HISTORICAL`)

Full backtest using historical market data with optimized parameters.

**Configuration:**
- `startDate`/`endDate`: Backtest period
- `initialCapital`: Starting capital (default: $10,000)
- `tradingFee`: Fee per trade (default: 0.1%)

**Progression Thresholds:**
- Sharpe Ratio ≥ 1.0
- Max Drawdown ≤ 25%
- Win Rate ≥ 45%

### 3. Live Replay Stage (`LIVE_REPLAY`)

Replay recent market data with realistic timing and execution delays.

**Configuration:**
- Same as historical, plus:
- `enablePacing`: Real-time pacing simulation
- `pacingSpeed`: Speed multiplier (1 = real-time)

**Progression Thresholds:**
- Sharpe Ratio ≥ 0.8
- Max Drawdown ≤ 30%
- Max Degradation from Historical ≤ 20%

### 4. Paper Trading Stage (`PAPER_TRADE`)

Live market simulation without real capital.

**Configuration:**
- `duration`: Trading duration (`7d`, `14d`, `30d`)
- `stopConditions`: Auto-stop triggers
  - `maxDrawdown`: Stop on excessive loss
  - `targetReturn`: Stop on profit target

**Progression Thresholds:**
- Sharpe Ratio ≥ 0.7
- Max Drawdown ≤ 35%
- Total Return ≥ 0%

## API Endpoints

### User Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/pipelines` | Create a new pipeline |
| `GET` | `/pipelines` | List user's pipelines |
| `GET` | `/pipelines/:id` | Get pipeline details |
| `POST` | `/pipelines/:id/start` | Start pipeline execution |
| `POST` | `/pipelines/:id/pause` | Pause running pipeline |
| `POST` | `/pipelines/:id/resume` | Resume paused pipeline |
| `POST` | `/pipelines/:id/cancel` | Cancel pipeline |
| `POST` | `/pipelines/:id/skip` | Skip current stage |
| `DELETE` | `/pipelines/:id` | Delete pipeline |
| `GET` | `/pipelines/:id/report` | Get summary report |

### Admin Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/pipelines/admin` | List all pipelines |
| `GET` | `/pipelines/admin/:id` | Get any pipeline |
| `POST` | `/pipelines/admin/:id/cancel` | Cancel any pipeline |

## Events

The pipeline module emits and listens to various events for cross-module communication:

### Emitted Events

| Event | Description |
|-------|-------------|
| `pipeline.stage-transition` | Pipeline moved to a new stage |
| `pipeline.status-change` | Pipeline status changed |
| `pipeline.progress` | Progress update within a stage |
| `pipeline.completed` | Pipeline finished successfully |
| `pipeline.failed` | Pipeline failed |

### Listened Events

| Event | Handler |
|-------|---------|
| `optimization.completed` | `handleOptimizationComplete()` |
| `backtest.completed` | `handleBacktestComplete()` |
| `paper-trading.completed` | `handlePaperTradingComplete()` |

## Deployment Recommendations

After all stages complete, the pipeline generates a deployment recommendation:

| Recommendation | Criteria |
|----------------|----------|
| **DEPLOY** | Sharpe ≥ 1.0, Drawdown ≤ 25%, Win Rate ≥ 50%, Consistency ≥ 70%, No warnings |
| **NEEDS_REVIEW** | Sharpe ≥ 0.5, Drawdown ≤ 40%, Win Rate ≥ 40%, Consistency ≥ 40% |
| **DO_NOT_DEPLOY** | Failed thresholds or critical warnings |

### Warning Types

- `HIGH_DEGRADATION`: >30% performance drop between stages
- `OVERFITTING_SUSPECTED`: Sharpe ratio declining across stages
- `LOW_TRADE_COUNT`: Fewer than 10 trades in any stage
- `HIGH_DRAWDOWN`: >30% max drawdown
- `POOR_WIN_RATE`: <40% win rate
- `NEGATIVE_RETURN`: Paper trading finished with loss
- `INCONSISTENT_METRICS`: High variance across stages

## Queue Configuration

The pipeline uses BullMQ for job processing:

```typescript
Queue Name: 'pipeline'
Job Types:
  - 'execute-stage': Execute a specific pipeline stage

Job Options:
  - Unique job IDs with timestamps
  - Automatic retry on failure
  - Configurable concurrency
```

## Usage Example

```typescript
// Create a pipeline
const pipeline = await pipelineOrchestrator.createPipeline({
  name: 'RSI Strategy Validation',
  description: 'Testing RSI-based mean reversion strategy',
  strategyConfigId: 'strategy-config-uuid',
  exchangeKeyId: 'exchange-key-uuid',
  stageConfig: {
    optimization: {
      trainDays: 90,
      testDays: 30,
      stepDays: 14,
      objectiveMetric: 'sharpe_ratio',
      maxCombinations: 500,
      earlyStop: true
    },
    historical: {
      startDate: '2024-01-01T00:00:00Z',
      endDate: '2024-06-01T00:00:00Z',
      initialCapital: 10000
    },
    liveReplay: {
      startDate: '2024-06-01T00:00:00Z',
      endDate: '2024-07-01T00:00:00Z',
      initialCapital: 10000
    },
    paperTrading: {
      initialCapital: 10000,
      duration: '7d',
      stopConditions: {
        maxDrawdown: 0.25,
        targetReturn: 0.5
      }
    }
  }
}, user);

// Start the pipeline
await pipelineOrchestrator.startPipeline(pipeline.id, user);
```

## Dependencies

- **OptimizationModule**: Parameter optimization
- **OrderModule**: Backtest and paper trading services
- **AuthenticationModule**: User authentication
- **BullMQ**: Job queue processing
- **EventEmitter**: Cross-module event communication

## Database Schema

The `Pipeline` entity stores:
- Pipeline metadata (name, description)
- Current status and stage
- Stage configuration
- Progression rules
- Stage results (JSON)
- Optimized parameters
- References to child entities (optimization run, backtests, paper trading session)
- Summary report

See `entities/pipeline.entity.ts` for full schema definition.

## Related Documentation

- [ADR-001: Pipeline Architecture](./docs/adr-001-pipeline-architecture.md)
- [Stage Flow Sequence Diagram](./docs/stage-flow-sequence.md)
