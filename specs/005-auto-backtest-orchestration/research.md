# Research Report: Automated Backtesting Orchestration

**Date**: 2025-10-28 **Feature**: Automated Backtesting Orchestration **Status**: Complete

## Executive Summary

This research document provides implementation guidance for extending the Chansey platform's backtesting capabilities
with fully automated orchestration. The research covers six key areas: walk-forward analysis, unified scoring
frameworks, market regime detection, drift detection, audit logging, and promotion gates with risk controls.

## Key Decisions and Technologies

### 1. Walk-Forward Analysis Implementation

**Decision**: Use rolling window approach with 60/40 train/test split **Rationale**:

- Rolling windows adapt to market regime changes better than anchored windows
- 60/40 split balances training data sufficiency with out-of-sample validation
- Crypto markets exhibit high regime variability requiring adaptive approaches

**Alternatives Considered**:

- Anchored windows: Rejected due to inability to adapt to regime changes
- 80/20 split: Rejected as insufficient test data for volatile crypto markets
- Monte Carlo simulation: Deferred to future enhancement due to computational cost

**Implementation Details**:

- 180-day training window, 90-day test window, 30-day step size
- Process 3 windows in parallel via BullMQ to optimize throughput
- Store intermediate results in PostgreSQL for failure recovery

### 2. Unified Scoring Framework

**Decision**: Multi-factor scoring with 7 weighted components **Rationale**:

- Balances return, risk, and robustness metrics
- Walk-forward degradation (20% weight) prevents overfitting
- Correlation scoring (10% weight) ensures portfolio diversification

**Alternatives Considered**:

- Single metric (Sharpe only): Rejected as insufficient for comprehensive evaluation
- Machine learning ensemble: Rejected as too opaque for regulatory compliance
- Equal weighting: Rejected as some metrics more predictive than others

**Component Weights**:

- Sharpe Ratio: 25% - Primary risk-adjusted return metric
- Calmar Ratio: 15% - Drawdown consideration
- Win Rate: 10% - Consistency measure
- Profit Factor: 10% - Win/loss magnitude
- WFA Degradation: 20% - Overfitting penalty
- Stability: 10% - Trade distribution
- Correlation: 10% - Portfolio diversification

### 3. Market Regime Detection

**Decision**: Realized volatility percentiles with 30-day rolling calculation **Rationale**:

- Simple, interpretable, and computationally efficient
- 365-day lookback provides stable historical reference
- Percentile thresholds (25th, 50th, 75th, 90th) align with industry standards

**Alternatives Considered**:

- Hidden Markov Models: Deferred due to complexity and interpretability
- GARCH models: Rejected as overly complex for initial implementation
- Simple moving averages: Rejected as insufficiently responsive to volatility shifts

**Regime Classifications**:

- Low Volatility: < 25th percentile
- Normal: 25th-75th percentile
- High Volatility: 75th-90th percentile
- Extreme Volatility: > 90th percentile

### 4. Performance Drift Detection

**Decision**: Statistical Process Control with multiple threshold checks **Rationale**:

- Rapid detection via control charts
- Multiple metrics prevent false positives
- 30-day lookback balances responsiveness with stability

**Alternatives Considered**:

- CUSUM charts only: Rejected as single method insufficient
- Fixed thresholds only: Rejected as not adaptive to strategy characteristics
- Machine learning anomaly detection: Deferred due to training data requirements

**Drift Thresholds**:

- Sharpe degradation: 50% worse than backtest
- Return underperformance: 15% below expectation
- Drawdown excess: 1.5x backtest maximum
- Win rate delta: 20 percentage points
- Consecutive losses: 10 trades
- Volatility ratio: 2x expected

### 5. Audit Logging Architecture

**Decision**: Immutable PostgreSQL storage with SHA-256 integrity hashing **Rationale**:

- Regulatory compliance requires tamper-proof logs
- 5-year retention meets financial industry standards
- Partitioning by month enables efficient archival

**Alternatives Considered**:

- Blockchain storage: Rejected as excessive overhead for internal audit
- File-based logging only: Rejected as insufficient for complex queries
- NoSQL storage: Rejected due to lack of ACID guarantees

**Implementation Features**:

- Cryptographic integrity verification
- Correlation IDs for event linking
- Before/after state capture
- Monthly partitioning for performance
- Append-only file backup for redundancy

### 6. Promotion Gates and Risk Controls

**Decision**: 8-gate system with progressive allocation (1-2% initial, up to 10% full) **Rationale**:

- Multiple gates prevent single-point failures
- Progressive rollout limits risk exposure
- 35-strategy limit maintains manageable portfolio

**Alternatives Considered**:

- Single score threshold: Rejected as insufficiently comprehensive
- Manual review only: Rejected as not scalable
- Immediate full allocation: Rejected as too risky

**Gate Requirements**:

- Minimum score: 70/100
- Minimum trades: 30 for significance
- Maximum drawdown: 40%
- WFA degradation: < 30%
- Correlation limit: 0.7
- Positive returns: Required
- Volatility cap: 150% annualized
- Portfolio capacity: 35 strategies max

## Technology Stack Integration

### Existing Infrastructure Leverage

The implementation will maximize use of existing Chansey infrastructure:

1. **NestJS Modules**: New modules for strategy, scoring, monitoring, audit
2. **TypeORM Entities**: Strategy configs, backtest runs, audit logs
3. **BullMQ Jobs**: Parallel window processing, scheduled evaluations
4. **PostgreSQL**: Primary storage with partitioning for performance
5. **Redis**: Caching metrics, volatility data, correlation matrices
6. **Angular Components**: Dashboard visualizations with PrimeNG
7. **TanStack Query**: Frontend state management for real-time updates

### New Dependencies

Minimal new dependencies required:

- Statistical libraries for advanced calculations (already available in Node.js ecosystem)
- No new infrastructure components needed

## Performance Considerations

### Optimization Strategies

1. **Parallel Processing**
   - BullMQ workers for concurrent window evaluation
   - Batch strategy scoring to reduce database load
   - Parallel risk checks across deployments

2. **Caching Strategy**
   - Redis cache for frequently accessed metrics (5-minute TTL)
   - Materialized views for aggregated performance data
   - Price data caching for regime detection

3. **Database Optimization**
   - Partitioned audit tables by month
   - Indexed strategy performance queries
   - Read replicas for analytical workloads

### Expected Performance Metrics

- Walk-forward analysis: 15 strategies/hour throughput
- Scoring calculation: < 500ms per strategy
- Drift detection: < 1 second per strategy
- Regime detection: < 2 seconds for full calculation
- Audit query: < 5 seconds for 5-year history
- Dashboard load: < 2 seconds for 35 strategies

## Risk Mitigation

### Technical Risks

1. **Data Quality Issues**
   - Mitigation: Validate data checksums, handle missing data gracefully
   - Fallback: Manual review queue for anomalous results

2. **Performance Degradation**
   - Mitigation: Implement circuit breakers, rate limiting
   - Fallback: Prioritize critical strategies, defer non-critical evaluations

3. **False Positive Drift Alerts**
   - Mitigation: Require sustained drift (3+ checks) before action
   - Fallback: Manual review for critical decisions

### Business Risks

1. **Over-aggressive Promotion**
   - Mitigation: Conservative initial gates, progressive rollout
   - Monitoring: Track 90-day success rate of promoted strategies

2. **Insufficient Diversification**
   - Mitigation: Correlation limits, strategy type diversity requirements
   - Monitoring: Portfolio concentration metrics

3. **Regulatory Compliance**
   - Mitigation: Immutable audit logs, role-based access control
   - Documentation: Complete decision trail for all automated actions

## Implementation Complexity

### Complexity Assessment

The feature implementation complexity is **MODERATE** based on:

**Low Complexity Aspects**:

- Leverages existing infrastructure extensively
- Uses established patterns from current codebase
- No new external dependencies or services

**Moderate Complexity Aspects**:

- Walk-forward analysis algorithm implementation
- Multi-factor scoring framework calibration
- Drift detection threshold tuning

**Managed Through**:

- Incremental implementation phases
- Comprehensive testing at each phase
- Conservative initial parameters with gradual optimization

## Recommendations

### Phase 1 Priority (Weeks 1-2)

1. Implement walk-forward analysis with basic metrics
2. Create audit logging infrastructure
3. Set up database schema and migrations

### Phase 2 Priority (Weeks 3-4)

1. Build unified scoring framework
2. Implement market regime detection
3. Create promotion gates

### Phase 3 Priority (Weeks 5-6)

1. Add drift detection and monitoring
2. Implement risk management controls
3. Build dashboard components

### Phase 4 Priority (Weeks 7-8)

1. Performance optimization
2. Comprehensive testing
3. Documentation and deployment

### Future Enhancements

After initial deployment, consider:

1. Machine learning ensemble for scoring
2. Hidden Markov Models for regime detection
3. Real-time strategy parameter optimization
4. Cross-exchange arbitrage detection
5. Sentiment analysis integration

## Conclusion

The automated backtesting orchestration system can be successfully implemented using the existing Chansey technology
stack with minimal additional dependencies. The phased approach reduces implementation risk while delivering value
incrementally. All design decisions prioritize simplicity, maintainability, and alignment with the project's
constitution principles.
