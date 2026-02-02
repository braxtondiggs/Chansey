# ADR-001: Strategy Development Pipeline Architecture

**Status:** Accepted
**Date:** 2026-01-26
**Authors:** Engineering Team

## Context

Chansey needs a systematic approach to validate trading strategies before deployment to live trading. Manual validation is error-prone, inconsistent, and doesn't scale as the number of strategies grows.

### Problem Statement

1. **Validation Inconsistency**: Different strategies are validated with different rigor
2. **Overfitting Risk**: Strategies optimized on historical data may fail in live conditions
3. **Manual Process**: Engineers must manually coordinate multiple testing stages
4. **No Clear Criteria**: Lack of standardized pass/fail thresholds for deployment decisions

### Requirements

- Automated multi-stage validation pipeline
- Configurable progression thresholds per stage
- Support for pause/resume to handle long-running validations
- Event-driven architecture for loose coupling between services
- Risk-adjusted thresholds based on user preferences
- Clear deployment recommendations with confidence scores

## Decision

Implement a four-stage validation pipeline with the following architecture:

### Stage Design

```
OPTIMIZE → HISTORICAL → LIVE_REPLAY → PAPER_TRADE → COMPLETED
```

#### Stage 1: Optimization
- **Purpose**: Find optimal strategy parameters using walk-forward analysis
- **Method**: Grid search with configurable parameter space
- **Output**: Best parameters and improvement percentage over baseline
- **Rationale**: Walk-forward optimization reduces overfitting by validating on out-of-sample data

#### Stage 2: Historical Backtest
- **Purpose**: Full performance evaluation on historical data
- **Method**: Standard backtest with optimized parameters
- **Output**: Comprehensive metrics (Sharpe, drawdown, win rate, etc.)
- **Rationale**: Provides baseline performance expectation

#### Stage 3: Live Replay
- **Purpose**: Test with realistic timing and execution conditions
- **Method**: Replay recent data with optional real-time pacing
- **Output**: Performance metrics with degradation analysis
- **Rationale**: Catches timing-sensitive bugs and unrealistic fill assumptions

#### Stage 4: Paper Trading
- **Purpose**: Live market validation without real capital
- **Method**: Simulated trading against live exchange data
- **Output**: Real-world performance under current market conditions
- **Rationale**: Final validation before risking real capital

### Architecture Decisions

#### Decision 1: Event-Driven Stage Transitions

**Choice**: Use NestJS EventEmitter for cross-module communication

**Alternatives Considered:**
- Direct service calls
- Message queue (RabbitMQ/Kafka)
- Polling-based coordination

**Rationale**:
- Loose coupling between pipeline and execution services
- Simpler than full message broker for single-instance deployment
- Easy to add WebSocket notifications later
- Maintains transaction boundaries within services

#### Decision 2: BullMQ for Job Processing

**Choice**: Use BullMQ for stage execution jobs

**Alternatives Considered:**
- In-process async execution
- Database-based job queue
- Agenda.js

**Rationale**:
- Redis-backed persistence survives server restarts
- Built-in retry logic with exponential backoff
- Job deduplication with unique IDs
- Consistent with existing queue infrastructure
- Dashboard support for monitoring

#### Decision 3: Configurable Progression Rules

**Choice**: Per-pipeline progression thresholds stored in entity

**Alternatives Considered:**
- Global thresholds in configuration
- Strategy-type specific defaults only
- User-defined only

**Rationale**:
- Flexibility for different strategy types and risk profiles
- Defaults provided for easy onboarding
- Supports risk-based configuration from user profiles

#### Decision 4: JSON-Stored Stage Results

**Choice**: Store stage results as JSON column in Pipeline entity

**Alternatives Considered:**
- Separate tables for each stage result type
- Document database (MongoDB)
- Normalized relational schema

**Rationale**:
- Simplifies schema evolution as stages evolve
- Single query retrieves all pipeline data
- Results are write-once, read-many (no normalization benefit)
- TypeORM JSON column support is mature

#### Decision 5: Optimistic Degradation Thresholds

**Choice**: Allow performance degradation between stages (20% historical→live, 30% live→paper)

**Alternatives Considered:**
- Strict improvement requirements
- No degradation limits
- Percentage of Sharpe ratio

**Rationale**:
- Real-world performance is typically lower than historical
- Some degradation is expected and acceptable
- Catches significant problems while allowing realistic strategies
- Based on industry research on backtest-to-live performance gap

### Database Indexes

```sql
-- Compound index for user's pipeline queries
CREATE INDEX idx_pipeline_user_status ON pipeline(user_id, status);

-- Foreign key index for strategy config lookups
CREATE INDEX idx_pipeline_strategy_config ON pipeline(strategy_config_id);

-- Status filtering for admin views
CREATE INDEX idx_pipeline_status ON pipeline(status);

-- Stage-based queries for monitoring
CREATE INDEX idx_pipeline_current_stage ON pipeline(current_stage);
```

## Consequences

### Positive

1. **Consistent Validation**: All strategies go through identical validation process
2. **Reduced Overfitting**: Multi-stage testing with increasing realism
3. **Automation**: Engineers can start validation and check results later
4. **Auditability**: Full history of validation results stored with strategy
5. **Scalability**: Queue-based processing handles concurrent validations
6. **Flexibility**: Configurable thresholds support different risk profiles

### Negative

1. **Complexity**: More moving parts than simple backtest
2. **Time**: Full pipeline takes days/weeks (paper trading duration)
3. **Resource Usage**: Multiple backtests per strategy increases compute cost
4. **Learning Curve**: Team needs to understand stage flow and event handling

### Risks

1. **Event Ordering**: Events from sub-systems must be handled idempotently
2. **State Management**: Pipeline state must survive service restarts
3. **Orphaned Pipelines**: Long-running paper trading may outlive server lifecycle

### Mitigations

1. **Idempotent Handlers**: Check pipeline state before processing events
2. **BullMQ Persistence**: Jobs survive restarts via Redis
3. **Scheduled Cleanup**: Task to identify and handle orphaned pipelines

## Implementation Notes

### Error Handling

- Stage failures set pipeline status to FAILED with reason
- Transient errors trigger job retry with exponential backoff
- User can resume failed pipelines from last successful stage

### Monitoring

- Pipeline status available via REST API
- Event emissions enable WebSocket progress updates (future)
- BullMQ dashboard shows queue health

### Future Enhancements

1. **Parallel Stages**: Run independent stages concurrently
2. **A/B Testing**: Compare multiple parameter sets simultaneously
3. **Auto-Restart**: Automatically resume after server restart
4. **WebSocket Updates**: Real-time progress to frontend
5. **Strategy Comparison**: Compare multiple strategies in single view

## References

- [BullMQ Documentation](https://docs.bullmq.io/)
- [NestJS Event Emitter](https://docs.nestjs.com/techniques/events)
- [Walk-Forward Optimization](https://www.investopedia.com/terms/w/walk-forward-testing.asp)
- [Backtest Overfitting Research](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2326253)
