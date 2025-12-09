# Quickstart Guide: Automated Backtesting Orchestration

**Feature**: Automated Backtesting Orchestration **Date**: 2025-10-28

## Overview

The Automated Backtesting Orchestration system enables fully autonomous strategy evaluation, scoring, and deployment.
This guide will help you get started with the system.

## Prerequisites

- Chansey platform account with appropriate permissions
- Access to the API (authentication token)
- Historical market data available (minimum 1 year)
- Understanding of trading strategy basics

## Quick Start in 5 Steps

### Step 1: Create a Strategy Configuration

First, define your trading strategy with its parameters:

```bash
POST /api/v1/strategies
{
  "name": "Momentum Breakout Strategy",
  "strategyType": "momentum",
  "parameters": {
    "lookbackPeriod": 20,
    "breakoutThreshold": 2.0,
    "stopLoss": 0.05,
    "takeProfit": 0.15,
    "positionSize": 0.02
  },
  "description": "Momentum strategy that trades on price breakouts"
}
```

### Step 2: Run Automated Backtesting

Start backtesting with walk-forward analysis:

```bash
POST /api/v1/strategies/{strategyId}/backtest
{
  "startDate": "2024-01-01",
  "endDate": "2024-12-31",
  "walkForwardConfig": {
    "trainDays": 180,
    "testDays": 90,
    "stepDays": 30,
    "method": "rolling"
  }
}
```

The system will:

- Generate multiple train/test windows
- Run backtests on each window
- Calculate performance metrics
- Detect potential overfitting

### Step 3: Review Strategy Score

Once backtesting completes, check the strategy score:

```bash
GET /api/v1/strategies/{strategyId}/score
```

Response includes:

- Overall score (0-100)
- Component scores (Sharpe, drawdown, etc.)
- Letter grade (A-F)
- Promotion eligibility
- Any warnings or concerns

### Step 4: Promote to Live Trading (If Eligible)

If the strategy passes all gates (score ≥ 70, etc.):

```bash
POST /api/v1/strategies/{strategyId}/promote
{
  "initialAllocation": 2.0,
  "reason": "Passed all promotion gates with A grade"
}
```

The system will:

- Verify promotion gates
- Deploy with conservative allocation (1-2%)
- Set up monitoring and risk limits
- Begin live trading

### Step 5: Monitor Performance

Track live performance and drift:

```bash
GET /api/v1/deployments/{deploymentId}/performance?startDate=2025-01-01
```

Check for drift alerts:

```bash
GET /api/v1/deployments/{deploymentId}/drift
```

## Key Concepts

### Walk-Forward Analysis

Walk-forward analysis prevents overfitting by testing strategies on out-of-sample data:

```
Training Period (180 days) → Testing Period (90 days)
     ↓ Step forward 30 days
Training Period (180 days) → Testing Period (90 days)
     ↓ Step forward 30 days
Training Period (180 days) → Testing Period (90 days)
```

### Scoring Framework

Strategies are scored across multiple dimensions:

| Component       | Weight | Good Range |
| --------------- | ------ | ---------- |
| Sharpe Ratio    | 25%    | > 1.0      |
| Calmar Ratio    | 15%    | > 1.0      |
| Win Rate        | 10%    | > 45%      |
| Profit Factor   | 10%    | > 1.5      |
| WFA Degradation | 20%    | < 30%      |
| Stability       | 10%    | Consistent |
| Correlation     | 10%    | < 0.7      |

### Promotion Gates

Strategies must pass multiple gates before live trading:

1. **Minimum Score**: ≥ 70/100
2. **Trade Count**: ≥ 30 trades
3. **Max Drawdown**: < 40%
4. **WFA Consistency**: < 30% degradation
5. **Positive Returns**: Required
6. **Portfolio Capacity**: < 35 strategies

### Risk Management

Live strategies are monitored for:

- **Drawdown Breach**: > 1.5x backtest max
- **Daily Loss**: > 5% in one day
- **Drift Detection**: 50% performance degradation
- **Benchmark Underperformance**: 15% below market

## Common Workflows

### Workflow 1: Automated Strategy Discovery

1. Create multiple strategy variations
2. System automatically evaluates all strategies
3. Top performers are flagged for review
4. Best strategies promoted to live trading

### Workflow 2: Market Regime Adaptation

1. System detects market regime change
2. All strategies re-evaluated for new regime
3. Underperformers demoted automatically
4. New strategies promoted if suitable

### Workflow 3: Progressive Allocation

1. Strategy starts with 1-2% allocation
2. After 30 days of success → 3-5%
3. After 90 days of success → 5-10%
4. Automatic reduction on drift detection

## Dashboard Access

Access the web dashboard at: `https://app.chansey.io/backtest`

Dashboard features:

- Strategy scorecard rankings
- Live performance monitoring
- Drift alerts and notifications
- Audit trail viewer
- Market regime indicator

## API Authentication

All API requests require authentication:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.chansey.io/v1/strategies
```

## Rate Limits

- Strategy creation: 10/minute
- Backtest initiation: 5/minute
- Performance queries: 100/minute
- Audit queries: 20/minute

## Troubleshooting

### Issue: Strategy Won't Promote

**Cause**: Not meeting promotion gates **Solution**: Check `/strategies/{id}/score` for specific gate failures

### Issue: Strategy Demoted Quickly

**Cause**: Performance drift or market regime change **Solution**: Review `/deployments/{id}/drift` for specific metrics

### Issue: Backtest Taking Too Long

**Cause**: Large date range or complex strategy **Solution**: Reduce date range or simplify parameters

### Issue: High Correlation Warning

**Cause**: Strategy too similar to existing deployments **Solution**: Modify strategy parameters for differentiation

## Best Practices

1. **Start Conservative**
   - Begin with well-tested strategy types
   - Use small allocations initially
   - Monitor closely for first 30 days

2. **Diversify Strategies**
   - Deploy multiple uncorrelated strategies
   - Mix strategy types (momentum, mean-reversion, etc.)
   - Target different market regimes

3. **Regular Review**
   - Check drift alerts weekly
   - Review audit logs monthly
   - Rebalance allocations quarterly

4. **Risk Management**
   - Never override safety limits
   - Respect automatic demotions
   - Document manual interventions

## Support Resources

- **Documentation**: https://docs.chansey.io/backtesting
- **API Reference**: https://api.chansey.io/docs
- **Support Email**: support@chansey.io
- **Community Forum**: https://forum.chansey.io

## Next Steps

1. Create your first strategy configuration
2. Run backtesting with walk-forward analysis
3. Review scores and warnings
4. Deploy top strategies with small allocations
5. Monitor and adjust based on performance

Remember: The system is designed to be autonomous but benefits from human oversight. Trust the gates and risk
controls—they're there to protect your capital.
