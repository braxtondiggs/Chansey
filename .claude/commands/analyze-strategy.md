---
allowed-tools: Read, Bash, Grep, Glob
argument-hint: <strategy-name> | <file-path> | --all | --idea "<description>"
description: Analyze, review, or design trading strategies with comprehensive technical analysis expertise
---

# Strategy Analysis

Analyze trading strategy: $ARGUMENTS

## Current Codebase Context

- Available strategies:
  !`ls apps/api/src/algorithm/strategies/*.ts 2>/dev/null | grep -v spec | xargs -I {} basename {} .ts | head -15`
- Base strategy: @apps/api/src/algorithm/base/base-algorithm-strategy.ts
- Indicator service: @apps/api/src/algorithm/indicators/indicator.service.ts

## Task

Perform a comprehensive analysis following these steps:

### 1. Strategy Identification

**If strategy name provided** (e.g., "rsi", "macd", "confluence"):

- Locate in `apps/api/src/algorithm/strategies/{name}.strategy.ts`
- Read implementation and any `.spec.ts` test file
- Identify strategy ID, description, version

**If file path provided**:

- Read the specified file directly
- Verify it extends `BaseAlgorithmStrategy`

**If `--all` provided**:

- List all strategies with brief summaries
- Provide comparison table

**If `--idea "<description>"` provided**:

- Design a NEW strategy based on the description
- Reference similar existing strategies
- Provide implementation guidance

### 2. Signal Logic Review

Analyze the trading logic:

**Signal Generation**

- What triggers BUY signals?
- What triggers SELL signals?
- Are there HOLD conditions?
- Is the logic mathematically sound?

**Indicator Usage**

- Which indicators are used?
- Are parameters within recommended ranges?
- Is `IndicatorService` used correctly?
- Proper handling of NaN/missing values?

**Confidence Calculation**

- How is signal confidence computed?
- Does it scale appropriately with signal strength?
- Any edge cases where confidence could be incorrect?

### 3. Configuration Analysis

Review `getConfigSchema()`:

| Parameter | Default | Recommended Range | Impact |
| --------- | ------- | ----------------- | ------ |

**Standard Ranges**:

- RSI period: 10-21 (default 14)
- MACD: Fast 8-15, Slow 20-30, Signal 7-12
- Bollinger Bands: Period 15-25, StdDev 1.5-2.5
- ATR period: 10-20
- EMA fast/slow: Ensure mathematical consistency

### 4. Risk Assessment

**Position Sizing**

- Does the strategy consider position sizing?
- Integration with ATR for dynamic sizing?

**Stop-Loss Logic**

- Built-in stop-loss mechanisms?
- Handling of adverse price movements?

**Drawdown Protection**

- Circuit breakers for large losses?
- Volatility filtering (like ATR filter in Confluence)?

### 5. Backtesting Recommendations

**Data Requirements**

- Minimum periods needed for indicator warmup
- Suggested historical periods (bull, bear, sideways)

**Parameter Optimization** For each key parameter, provide:

- Lower bound
- Upper bound
- Step size for grid search

**Key Metrics to Track**

- Sharpe Ratio (risk-adjusted returns)
- Maximum Drawdown
- Win Rate
- Profit Factor (gross profit / gross loss)
- Trade Frequency

### 6. Improvement Suggestions

**Priority 1 - Quick Wins**

- Parameter tuning
- Edge case handling
- Confidence calculation fixes

**Priority 2 - Short Term**

- Additional confirmation indicators
- Market regime filters
- Improved exit strategies

**Priority 3 - Long Term**

- Machine learning integration
- Multi-timeframe analysis
- Adaptive parameters

### 7. Strategy Comparison

Compare with related strategies:

- **Confluence**: Multi-indicator agreement (best for high-probability)
- **RSI**: Mean-reversion (best for ranging markets)
- **MACD**: Trend-following (best for trending markets)
- **Triple EMA**: Trend identification (best for strong trends)

### 8. Code Quality Check

- Follows `BaseAlgorithmStrategy` pattern
- Proper error handling and logging
- Has unit tests (`*.spec.ts`)
- TypeScript types well-defined
- Uses centralized `IndicatorService`

## Output Format

```
## Strategy: [Name]
**ID**: [strategy-id] | **Version**: [X.X.X] | **Category**: [TECHNICAL/HYBRID/etc]

### Signal Logic
| Condition | Signal | Confidence Factor |
|-----------|--------|-------------------|

### Configuration
| Parameter | Default | Range | Impact Level |
|-----------|---------|-------|--------------|

### Risk Assessment
- Position sizing: [Yes/No]
- Stop-loss: [Built-in/Manual/None]
- Volatility filter: [Yes/No]

### Backtest Parameters
| Parameter | Min | Max | Step |
|-----------|-----|-----|------|

### Improvement Roadmap
1. [Priority 1 items]
2. [Priority 2 items]
3. [Priority 3 items]

### Code Quality: X/10
[Justification]
```

## Indicator Formula Reference

### Momentum Indicators

**RSI**: `RSI = 100 - (100 / (1 + RS))` where RS = Avg Gain / Avg Loss

- Oversold: <30, Overbought: >70, Neutral: 30-70

**Stochastic**: `%K = (Close - Low(n)) / (High(n) - Low(n)) * 100`

- %D = SMA(%K, 3), Oversold: <20, Overbought: >80

**CCI**: `CCI = (Typical Price - SMA) / (0.015 * Mean Deviation)`

- Overbought: >100, Oversold: <-100

**Williams %R**: `%R = (Highest High - Close) / (Highest High - Lowest Low) * -100`

**MFI**: Volume-weighted RSI using typical price \* volume

### Trend Indicators

**MACD**:

- MACD Line = EMA(fast) - EMA(slow)
- Signal = EMA(MACD, signal period)
- Histogram = MACD - Signal

**ADX**: Measures trend strength (not direction)

- +DI = (Smoothed +DM / ATR) \* 100
- -DI = (Smoothed -DM / ATR) \* 100
- ADX = Smoothed absolute difference of +DI/-DI
- > 25 = trending, <20 = ranging

**Ichimoku**:

- Tenkan-sen = (9-period high + low) / 2
- Kijun-sen = (26-period high + low) / 2
- Senkou A = (Tenkan + Kijun) / 2, shifted 26 periods
- Senkou B = (52-period high + low) / 2, shifted 26 periods

### Volatility Indicators

**Bollinger Bands**:

- Middle = SMA(period)
- Upper = Middle + (StdDev \* multiplier)
- Lower = Middle - (StdDev \* multiplier)
- %B = (Price - Lower) / (Upper - Lower)
- Bandwidth = (Upper - Lower) / Middle

**ATR**: `ATR = EMA/SMA of True Range`

- TR = max(High-Low, |High-PrevClose|, |Low-PrevClose|)

**Keltner Channels**:

- Middle = EMA(period)
- Upper = EMA + (ATR \* multiplier)
- Lower = EMA - (ATR \* multiplier)

**Donchian Channels**:

- Upper = Highest High(period)
- Lower = Lowest Low(period)

### Volume Indicators

**OBV**: Cumulative volume (add on up days, subtract on down days)

**VWAP**: `VWAP = Sum(Price * Volume) / Sum(Volume)`

**CMF**: `CMF = Sum(Money Flow Volume) / Sum(Volume)` over period

**A/D Line**: `AD = ((Close - Low) - (High - Close)) / (High - Low) * Volume`

## Strategy Design Patterns

### Trend Following

- Use: MA crossovers, ADX filter, Ichimoku cloud
- Best in: Strong trending markets
- Risk: Whipsaws in ranging markets

### Mean Reversion

- Use: RSI extremes, Bollinger band bounces, Z-score
- Best in: Range-bound markets
- Risk: Catching falling knives in trends

### Breakout

- Use: Donchian channels, Bollinger squeeze, volume confirmation
- Best in: After consolidation periods
- Risk: False breakouts, fakeouts

### Momentum

- Use: RSI, Stochastic, MACD histogram
- Best in: Continuation of existing trends
- Risk: Late entries, reversals

### Multi-Indicator Confluence

- Use: 3+ indicators agreeing for signal
- Best in: High-probability setups
- Risk: Missing opportunities, analysis paralysis

## Common Pitfalls to Check

1. **Overfitting**: Too many parameters tuned to historical data
2. **Look-Ahead Bias**: Using future data in calculations
3. **Survivorship Bias**: Only testing on assets that still exist
4. **Curve Fitting**: Strategy only works on specific historical period
5. **Ignoring Fees/Slippage**: Not accounting for execution costs
6. **No Risk Management**: Missing stop-losses or position sizing
7. **Correlated Signals**: Multiple indicators measuring the same thing
8. **Wrong Timeframe**: Strategy assumptions don't match execution timeframe
