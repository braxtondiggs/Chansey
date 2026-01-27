# Pipeline Stage Flow - Sequence Diagrams

This document illustrates the sequence of operations for the Strategy Development Pipeline.

## Complete Pipeline Flow

```mermaid
sequenceDiagram
    participant User
    participant Controller as PipelineController
    participant Orchestrator as PipelineOrchestratorService
    participant Queue as BullMQ Pipeline Queue
    participant Processor as PipelineProcessor
    participant OptService as OptimizationService
    participant BacktestService
    participant PaperTradingService
    participant EventEmitter
    participant ReportService as PipelineReportService

    %% Pipeline Creation
    User->>Controller: POST /pipelines
    Controller->>Orchestrator: createPipeline(dto, user)
    Orchestrator->>Orchestrator: Validate strategyConfig exists
    Orchestrator->>Orchestrator: Validate exchangeKey belongs to user
    Orchestrator-->>Controller: Pipeline (status: PENDING)
    Controller-->>User: 201 Created

    %% Pipeline Start
    User->>Controller: POST /pipelines/:id/start
    Controller->>Orchestrator: startPipeline(id, user)
    Orchestrator->>Orchestrator: Update status → RUNNING
    Orchestrator->>Queue: add('execute-stage', {stage: OPTIMIZE})
    Orchestrator-->>Controller: Pipeline (status: RUNNING)
    Controller-->>User: 200 OK

    %% Stage 1: Optimization
    Queue->>Processor: process(job)
    Processor->>Orchestrator: executeStage(id, OPTIMIZE)
    Orchestrator->>OptService: startOptimization(config)
    OptService-->>Orchestrator: OptimizationRun
    Note over OptService: Optimization runs async...
    OptService->>EventEmitter: emit('optimization.completed')
    EventEmitter->>Orchestrator: handleOptimizationComplete()
    Orchestrator->>Orchestrator: Evaluate: improvement ≥ 5%?
    alt Passed
        Orchestrator->>Orchestrator: Store optimized parameters
        Orchestrator->>Queue: add('execute-stage', {stage: HISTORICAL})
    else Failed
        Orchestrator->>Orchestrator: failPipeline(reason)
        Orchestrator->>EventEmitter: emit('pipeline.failed')
    end

    %% Stage 2: Historical Backtest
    Queue->>Processor: process(job)
    Processor->>Orchestrator: executeStage(id, HISTORICAL)
    Orchestrator->>BacktestService: createBacktest(type: HISTORICAL)
    BacktestService-->>Orchestrator: Backtest
    Note over BacktestService: Backtest runs async...
    BacktestService->>EventEmitter: emit('backtest.completed')
    EventEmitter->>Orchestrator: handleBacktestComplete(HISTORICAL)
    Orchestrator->>Orchestrator: Evaluate thresholds
    alt Passed
        Orchestrator->>Orchestrator: Store historical results
        Orchestrator->>Queue: add('execute-stage', {stage: LIVE_REPLAY})
    else Failed
        Orchestrator->>Orchestrator: failPipeline(reason)
    end

    %% Stage 3: Live Replay
    Queue->>Processor: process(job)
    Processor->>Orchestrator: executeStage(id, LIVE_REPLAY)
    Orchestrator->>BacktestService: createBacktest(type: LIVE_REPLAY)
    BacktestService-->>Orchestrator: Backtest
    Note over BacktestService: Live replay runs async...
    BacktestService->>EventEmitter: emit('backtest.completed')
    EventEmitter->>Orchestrator: handleBacktestComplete(LIVE_REPLAY)
    Orchestrator->>Orchestrator: Evaluate thresholds + degradation
    alt Passed
        Orchestrator->>Orchestrator: Store live replay results
        Orchestrator->>Queue: add('execute-stage', {stage: PAPER_TRADE})
    else Failed
        Orchestrator->>Orchestrator: failPipeline(reason)
    end

    %% Stage 4: Paper Trading
    Queue->>Processor: process(job)
    Processor->>Orchestrator: executeStage(id, PAPER_TRADE)
    Orchestrator->>PaperTradingService: startFromPipeline(config)
    PaperTradingService-->>Orchestrator: PaperTradingSession
    Note over PaperTradingService: Paper trading runs for days...
    PaperTradingService->>EventEmitter: emit('paper-trading.completed')
    EventEmitter->>Orchestrator: handlePaperTradingComplete()
    Orchestrator->>Orchestrator: Evaluate thresholds
    alt Passed
        Orchestrator->>Orchestrator: completePipeline()
        Orchestrator->>Orchestrator: generateRecommendation()
        Orchestrator->>EventEmitter: emit('pipeline.completed')
    else Failed
        Orchestrator->>Orchestrator: failPipeline(reason)
    end

    %% Report Generation
    User->>Controller: GET /pipelines/:id/report
    Controller->>ReportService: generateSummaryReport(id)
    ReportService->>ReportService: Build stage comparison
    ReportService->>ReportService: Calculate consistency score
    ReportService->>ReportService: Detect warnings
    ReportService->>ReportService: Generate recommendation
    ReportService-->>Controller: PipelineSummaryReport
    Controller-->>User: 200 OK (report)
```

## Pause/Resume Flow

```mermaid
sequenceDiagram
    participant User
    participant Controller
    participant Orchestrator
    participant BacktestService
    participant PaperTradingService

    %% Pause
    User->>Controller: POST /pipelines/:id/pause
    Controller->>Orchestrator: pausePipeline(id, user)
    Orchestrator->>Orchestrator: Update status → PAUSED

    alt Current Stage: OPTIMIZE
        Orchestrator->>Orchestrator: Log pause (optimization continues to completion)
    else Current Stage: HISTORICAL or LIVE_REPLAY
        Orchestrator->>BacktestService: pauseBacktest(backtestId)
    else Current Stage: PAPER_TRADE
        Orchestrator->>PaperTradingService: pause(sessionId)
    end

    Orchestrator-->>Controller: Pipeline (status: PAUSED)
    Controller-->>User: 200 OK

    %% Resume
    User->>Controller: POST /pipelines/:id/resume
    Controller->>Orchestrator: resumePipeline(id, user)
    Orchestrator->>Orchestrator: Update status → RUNNING

    alt Current Stage: OPTIMIZE (no runId)
        Orchestrator->>Orchestrator: Re-queue optimization stage
    else Current Stage: OPTIMIZE (has runId)
        Note over Orchestrator: Optimization still running, will complete
    else Current Stage: HISTORICAL or LIVE_REPLAY
        Orchestrator->>BacktestService: resumeBacktest(backtestId)
    else Current Stage: PAPER_TRADE
        Orchestrator->>PaperTradingService: resume(sessionId)
    end

    Orchestrator-->>Controller: Pipeline (status: RUNNING)
    Controller-->>User: 200 OK
```

## Cancel Flow

```mermaid
sequenceDiagram
    participant User
    participant Controller
    participant Orchestrator
    participant Queue
    participant OptService
    participant BacktestService
    participant PaperTradingService

    User->>Controller: POST /pipelines/:id/cancel
    Controller->>Orchestrator: cancelPipeline(id, user)
    Orchestrator->>Orchestrator: Update status → CANCELLED
    Orchestrator->>Orchestrator: Set completedAt, failureReason

    alt Current Stage: OPTIMIZE
        Orchestrator->>OptService: cancelOptimization(runId)
    else Current Stage: HISTORICAL or LIVE_REPLAY
        Orchestrator->>BacktestService: cancelBacktest(backtestId)
    else Current Stage: PAPER_TRADE
        Orchestrator->>PaperTradingService: stop(sessionId, 'pipeline_cancelled')
    end

    Orchestrator->>Queue: remove(jobId)
    Orchestrator-->>Controller: Pipeline (status: CANCELLED)
    Controller-->>User: 200 OK
```

## Stage Progression Logic

```mermaid
flowchart TD
    subgraph OPTIMIZE
        O1[Start Optimization]
        O2{Improvement ≥ 5%?}
        O3[Store Best Parameters]
    end

    subgraph HISTORICAL
        H1[Run Historical Backtest]
        H2{Sharpe ≥ 1.0?}
        H3{Drawdown ≤ 25%?}
        H4{Win Rate ≥ 45%?}
        H5[Store Results]
    end

    subgraph LIVE_REPLAY
        L1[Run Live Replay]
        L2{Sharpe ≥ 0.8?}
        L3{Drawdown ≤ 30%?}
        L4{Degradation ≤ 20%?}
        L5[Store Results]
    end

    subgraph PAPER_TRADE
        P1[Start Paper Trading]
        P2{Sharpe ≥ 0.7?}
        P3{Drawdown ≤ 35%?}
        P4{Return ≥ 0%?}
        P5[Store Results]
    end

    subgraph COMPLETION
        C1[Generate Report]
        C2[Calculate Recommendation]
        C3[Mark COMPLETED]
    end

    FAIL[Mark FAILED]

    O1 --> O2
    O2 -->|Yes| O3
    O2 -->|No| FAIL
    O3 --> H1

    H1 --> H2
    H2 -->|Yes| H3
    H2 -->|No| FAIL
    H3 -->|Yes| H4
    H3 -->|No| FAIL
    H4 -->|Yes| H5
    H4 -->|No| FAIL
    H5 --> L1

    L1 --> L2
    L2 -->|Yes| L3
    L2 -->|No| FAIL
    L3 -->|Yes| L4
    L3 -->|No| FAIL
    L4 -->|Yes| L5
    L4 -->|No| FAIL
    L5 --> P1

    P1 --> P2
    P2 -->|Yes| P3
    P2 -->|No| FAIL
    P3 -->|Yes| P4
    P3 -->|No| FAIL
    P4 -->|Yes| P5
    P4 -->|No| FAIL
    P5 --> C1

    C1 --> C2
    C2 --> C3
```

## Event Flow

```mermaid
flowchart LR
    subgraph External Modules
        OPT[OptimizationModule]
        BT[BacktestModule]
        PT[PaperTradingModule]
    end

    subgraph Events
        E1[optimization.completed]
        E2[backtest.completed]
        E3[paper-trading.completed]
    end

    subgraph Pipeline Module
        EL[PipelineEventListener]
        OS[PipelineOrchestratorService]
    end

    subgraph Emitted Events
        E4[pipeline.stage-transition]
        E5[pipeline.completed]
        E6[pipeline.failed]
    end

    OPT -->|emit| E1
    BT -->|emit| E2
    PT -->|emit| E3

    E1 --> EL
    E2 --> EL
    E3 --> EL

    EL -->|handle| OS

    OS -->|emit| E4
    OS -->|emit| E5
    OS -->|emit| E6
```

## State Machine

```mermaid
stateDiagram-v2
    [*] --> PENDING: createPipeline()

    PENDING --> RUNNING: startPipeline()

    RUNNING --> PAUSED: pausePipeline()
    RUNNING --> CANCELLED: cancelPipeline()
    RUNNING --> FAILED: Stage threshold not met
    RUNNING --> COMPLETED: All stages passed

    PAUSED --> RUNNING: resumePipeline()
    PAUSED --> CANCELLED: cancelPipeline()

    COMPLETED --> [*]
    FAILED --> [*]
    CANCELLED --> [*]
```

## Notes

### Timeout Handling

- Each stage has implicit timeouts based on the underlying service
- Paper trading duration is configurable (`7d`, `14d`, etc.)
- If a stage doesn't complete, manual intervention may be required

### Idempotency

- Event handlers check pipeline status before processing
- Duplicate events are safely ignored
- Job IDs include timestamps to prevent BullMQ rejections

### Recovery

- Pipeline state is persisted in PostgreSQL
- BullMQ jobs are persisted in Redis
- After restart, pending jobs resume automatically

### Monitoring Points

1. Queue depth: `pipeline` queue in BullMQ dashboard
2. Stage duration: Compare `startedAt` with stage completion times
3. Failure rate: Count pipelines in FAILED status
4. Progression rate: Pipelines that pass each stage threshold
