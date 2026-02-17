# Algorithm Module

The Algorithm module provides a framework for implementing and executing cryptocurrency trading algorithms. It analyzes
market data and generates trading signals based on various technical analysis strategies.

## What It Does

The Algorithm module:

- **Analyzes Market Data**: Processes price history, volume, and market trends for supported cryptocurrencies
- **Generates Trading Signals**: Produces buy/sell/hold recommendations based on algorithmic analysis
- **Provides Multiple Strategies**: Supports various trading algorithms including moving averages, mean reversion, and
  momentum indicators
- **Executes Automated Analysis**: Runs algorithms on schedules or on-demand to provide real-time trading insights
- **Tracks Performance**: Monitors algorithm execution metrics and success rates

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Algorithm Module                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ Algorithm       │    │ AlgorithmRegistry│               │
│  │ Controller      │◄───┤ Service          │               │
│  └─────────────────┘    └──────────────────┘               │
│           │                       │                        │
│           ▼                       ▼                        │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ Context Builder │    │ Strategy Pattern │               │
│  │ Service         │    │ Implementation   │               │
│  └─────────────────┘    └──────────────────┘               │
│           │                       │                        │
│           ▼                       ▼                        │
│  ┌─────────────────┐    ┌──────────────────┐               │
│  │ Algorithm       │    │ Base Algorithm   │               │
│  │ Context         │    │ Strategy         │               │
│  └─────────────────┘    └──────────────────┘               │
│                                   │                        │
│                                   ▼                        │
│                          ┌──────────────────┐               │
│                          │ Concrete         │               │
│                          │ Strategies       │               │
│                          │ (EMA, etc.)      │               │
│                          └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

## Available Algorithms

### 1. Simple Moving Average Crossover

- **Purpose**: Identifies trend changes using fast and slow moving averages
- **How it works**: Generates buy signals when the fast MA crosses above the slow MA, and sell signals when it crosses
  below
- **Configuration**: Customize fast period (default: 12) and slow period (default: 26)
- **Best for**: Trending markets with clear directional momentum

### 2. Exponential Moving Average Strategy

- **Purpose**: Uses exponentially weighted averages for more responsive trend detection
- **How it works**: Analyzes price relationship to EMA and detects slope changes for signal generation
- **Configuration**: Adjustable EMA period and sensitivity thresholds
- **Best for**: Markets with frequent price changes requiring faster response times

### 3. Mean Reversion Strategy

- **Purpose**: Identifies overbought/oversold conditions for contrarian trading opportunities
- **How it works**: Compares current price to historical average and generates signals when deviation exceeds thresholds
- **Configuration**: Customizable lookback period and deviation multipliers
- **Best for**: Range-bound markets with predictable price oscillations

### 4. RSI Strategy

- **Purpose**: Uses Relative Strength Index to identify momentum shifts and overbought/oversold conditions
- **How it works**: Generates buy signals when RSI falls below oversold threshold, sell signals when above overbought
  threshold
- **Configuration**: Adjustable RSI period, overbought/oversold thresholds
- **Best for**: Markets with clear momentum reversals

### 5. MACD Strategy

- **Purpose**: Identifies trend changes using Moving Average Convergence Divergence
- **How it works**: Analyzes MACD line crossovers with signal line and histogram momentum
- **Configuration**: Fast period, slow period, and signal period settings
- **Best for**: Trending markets with sustained momentum

### 6. Bollinger Bands Breakout Strategy

- **Purpose**: Detects volatility breakouts and potential trend reversals
- **How it works**: Generates signals when price breaks above/below Bollinger Bands with volume confirmation
- **Configuration**: Band period, standard deviation multiplier, breakout sensitivity
- **Best for**: Markets experiencing volatility expansion

### 7. RSI-MACD Combo Strategy

- **Purpose**: Combines RSI momentum with MACD trend confirmation for higher accuracy signals
- **How it works**: Only generates signals when both RSI and MACD indicators agree on direction
- **Configuration**: Individual settings for both RSI and MACD components
- **Best for**: Reducing false signals through multi-indicator confirmation

### 8. ATR Trailing Stop Strategy

- **Purpose**: Uses Average True Range for dynamic stop-loss positioning and trend following
- **How it works**: Generates signals based on ATR-based trailing stops and trend direction
- **Configuration**: ATR period, multiplier for stop distance
- **Best for**: Trending markets where dynamic stop placement improves exits

### 9. RSI Divergence Strategy

- **Purpose**: Identifies divergences between price and RSI for early reversal signals
- **How it works**: Detects when price makes new highs/lows but RSI doesn't confirm
- **Configuration**: RSI period, divergence lookback period, minimum divergence threshold
- **Best for**: Catching trend reversals before they happen

### 10. Bollinger Band Squeeze Strategy

- **Purpose**: Identifies low volatility periods that often precede large moves
- **How it works**: Detects when Bollinger Bands narrow significantly, signaling potential breakout
- **Configuration**: Squeeze threshold, breakout confirmation settings
- **Best for**: Anticipating volatility expansion after consolidation

### 11. Triple EMA Strategy

- **Purpose**: Uses three EMAs for enhanced trend detection and confirmation
- **How it works**: Analyzes relationships between short, medium, and long-term EMAs
- **Configuration**: Three EMA periods (short, medium, long)
- **Best for**: Strong trending markets with clear directional bias

### 12. EMA-RSI Filter Strategy

- **Purpose**: Combines EMA trend direction with RSI momentum filtering
- **How it works**: Uses EMA for trend direction and RSI to filter entry timing
- **Configuration**: EMA period, RSI period, RSI thresholds
- **Best for**: Following trends with momentum-based entry timing

### 13. Multi-Indicator Confluence Strategy

- **Purpose**: Reduces false positives by requiring multiple indicators to agree before generating signals
- **How it works**: Combines 5 indicator families (EMA trend, RSI momentum, MACD oscillator, ATR volatility filter,
  Bollinger Bands mean reversion) and only generates signals when a configurable minimum number of indicators agree on
  direction
- **Configuration**: Minimum confluence count, individual indicator enable/disable, custom thresholds for each indicator
- **Best for**: Conservative traders seeking high-confidence signals with reduced noise

#### Signal Logic

**BUY Signal** (when configured minimum indicators agree):

- **EMA**: EMA12 > EMA26 (bullish trend)
- **RSI**: RSI > 55 (strong upward momentum confirms trend)
- **MACD**: Histogram positive with upward momentum
- **ATR**: Volatility within normal range (filter, not directional)
- **Bollinger Bands**: %B > 0.55 (price pushing upper band, confirms uptrend)

**SELL Signal** (when configured minimum indicators agree):

- **EMA**: EMA12 < EMA26 (bearish trend)
- **RSI**: RSI < 45 (weak momentum confirms downtrend)
- **MACD**: Histogram negative with downward momentum
- **ATR**: Volatility within normal range (filter, not directional)
- **Bollinger Bands**: %B < 0.45 (price pushing lower band, confirms downtrend)

#### Configuration Options

| Option                    | Type    | Default | Description                                                |
| ------------------------- | ------- | ------- | ---------------------------------------------------------- |
| `minConfluence`           | number  | 3       | Number of indicators that must agree for BUY (2-5)         |
| `minSellConfluence`       | number  | 3       | Number of indicators that must agree for SELL (2-5)        |
| `minConfidence`           | number  | 0.65    | Minimum confidence threshold to generate signal            |
| `emaEnabled`              | boolean | true    | Enable EMA trend indicator                                 |
| `emaFastPeriod`           | number  | 12      | Fast EMA period                                            |
| `emaSlowPeriod`           | number  | 26      | Slow EMA period                                            |
| `rsiEnabled`              | boolean | true    | Enable RSI momentum indicator                              |
| `rsiPeriod`               | number  | 14      | RSI calculation period                                     |
| `rsiBuyThreshold`         | number  | 55      | RSI threshold for bullish signal (trend-following)         |
| `rsiSellThreshold`        | number  | 45      | RSI threshold for bearish signal (trend-following)         |
| `macdEnabled`             | boolean | true    | Enable MACD oscillator                                     |
| `macdFastPeriod`          | number  | 12      | MACD fast EMA period                                       |
| `macdSlowPeriod`          | number  | 26      | MACD slow EMA period                                       |
| `macdSignalPeriod`        | number  | 9       | MACD signal line period                                    |
| `atrEnabled`              | boolean | true    | Enable ATR volatility filter                               |
| `atrPeriod`               | number  | 14      | ATR calculation period                                     |
| `atrVolatilityMultiplier` | number  | 1.5     | Max ATR multiplier before filtering signals                |
| `bbEnabled`               | boolean | true    | Enable Bollinger Bands                                     |
| `bbPeriod`                | number  | 20      | Bollinger Bands calculation period                         |
| `bbStdDev`                | number  | 2       | Standard deviation multiplier                              |
| `bbBuyThreshold`          | number  | 0.55    | %B threshold for bullish signal (price pushing upper band) |
| `bbSellThreshold`         | number  | 0.45    | %B threshold for bearish signal (price pushing lower band) |

## How Algorithms Work

Each algorithm follows a standardized process:

1. **Data Collection**: Gathers historical price data, volume, and market indicators for analysis
2. **Signal Generation**: Applies mathematical models and technical indicators to identify trading opportunities
3. **Result Output**: Returns structured trading signals with confidence levels and supporting data
4. **Performance Tracking**: Monitors execution metrics and maintains historical performance records

## Getting Started

### 1. List Available Algorithms

```bash
GET /api/algorithm/strategies
```

Returns all available algorithm strategies with their descriptions and current status.

### 2. Execute an Algorithm

```bash
POST /api/algorithm/{algorithmId}/execute
```

Runs the specified algorithm and returns trading signals based on current market data.

### 3. Get Algorithm Details

```bash
GET /api/algorithm/{algorithmId}
```

Retrieves detailed information about a specific algorithm including its configuration options and recent performance.

### 4. Monitor Algorithm Health

```bash
GET /api/algorithm/health
```

Checks the health status of all algorithms and their execution capabilities.

## Using the API

### Execute Simple Moving Average Strategy

```bash
curl -X POST http://localhost:3000/api/algorithm/simple-moving-average-crossover/execute
```

**Response:**

````json
{
  "success": true,
  "signals": [
    {
      "coinId": "bitcoin",
      "type": "BUY",
      "confidence": 0.75,
      "price": 45000,
      "timestamp": "2024-01-01T12:00:00Z"
    }
  ],
  "metrics": {
    "executionTime": 150,
    "signalsGenerated": 3,
    "confidence": 0.68
  }
}

## Understanding Trading Signals

### Signal Types

- **BUY**: Algorithm recommends purchasing the asset
- **SELL**: Algorithm recommends selling the asset
- **HOLD**: Algorithm recommends maintaining current position

### Signal Properties

```json
{
  "coinId": "bitcoin",           // Cryptocurrency identifier
  "type": "BUY",                 // Signal type (BUY/SELL/HOLD)
  "confidence": 0.75,            // Confidence level (0-1)
  "price": 45000,                // Current market price
  "timestamp": "2024-01-01T12:00:00Z",  // Signal generation time
  "reason": "Fast MA crossed above slow MA"  // Human-readable explanation
}
````

### Interpreting Confidence Levels

- **0.9 - 1.0**: Very high confidence - strong signal
- **0.7 - 0.9**: High confidence - reliable signal
- **0.5 - 0.7**: Moderate confidence - proceed with caution
- **0.3 - 0.5**: Low confidence - consider other factors
- **0.0 - 0.3**: Very low confidence - signal may be noise

## Creating Custom Algorithms

To add a new trading algorithm:

1. **Extend BaseAlgorithmStrategy**:

   ```typescript
   @Injectable()
   export class MyCustomStrategy extends BaseAlgorithmStrategy {
     readonly id = 'my-custom-algorithm';
     readonly name = 'My Custom Algorithm';
     readonly version = '1.0.0';
     readonly description = 'Custom algorithm for specific market conditions';
   }
   ```

2. **Implement Core Logic**:

   ```typescript
   async execute(context: AlgorithmContext): Promise<AlgorithmResult> {
     const signals: TradingSignal[] = [];

     // Analyze market data from context
     for (const coin of context.coins) {
       const priceHistory = context.priceData[coin.id];
       // Apply your algorithm logic here

       if (/* buy condition */) {
         signals.push(this.createBuySignal(coin, confidence));
       }
     }

     return this.createSuccessResult(signals);
   }
   ```

## Configuration Options

### Algorithm Settings

Each algorithm can be configured with specific parameters:

#### Simple Moving Average Crossover

```json
{
  "fastPeriod": 12, // Fast moving average period (days)
  "slowPeriod": 26, // Slow moving average period (days)
  "enabled": true, // Enable/disable algorithm
  "weight": 1.0 // Signal weight (0-10)
}
```

#### Exponential Moving Average

```json
{
  "period": 21, // EMA calculation period
  "threshold": 0.02, // Price deviation threshold (2%)
  "enabled": true,
  "weight": 1.5
}
```

#### Mean Reversion

```json
{
  "lookbackPeriod": 20, // Historical data period for mean calculation
  "deviationMultiplier": 2.0, // Standard deviation multiplier
  "enabled": true,
  "weight": 0.8
}
```

### Global Settings

- **Risk Level**: Set overall risk tolerance (low/medium/high)
- **Execution Frequency**: Configure how often algorithms run
- **Data Retention**: Specify how long to keep historical results

```

## Best Practices

### When to Use Each Algorithm

#### Simple Moving Average Crossover
- **Use when**: Market shows clear trending behavior
- **Avoid when**: Market is sideways/choppy with frequent false signals
- **Tip**: Combine with volume indicators for better accuracy

#### Exponential Moving Average
- **Use when**: You need faster response to price changes
- **Avoid when**: Market is very volatile with lots of noise
- **Tip**: Shorter periods (10-15) for day trading, longer (21-50) for swing trading

#### Mean Reversion
- **Use when**: Asset trades in a predictable range
- **Avoid when**: Strong trending markets that break normal ranges
- **Tip**: Works well with overbought/oversold indicators like RSI

### Risk Management Guidelines

1. **Diversify strategies** - Use multiple algorithms for confirmation
2. **Monitor confidence levels** - Higher confidence signals are more reliable
3. **Set position limits** - Don't allocate too much capital to algorithmic signals
4. **Regular performance review** - Algorithm effectiveness can change with market conditions
5. **Implement stop losses** - Always have risk management rules in place

## Future Enhancements

### Planned Features

1. **Real-time Execution**: WebSocket support for live algorithm updates and streaming signals
2. **Historical Analysis**: Backtesting framework to test algorithms against historical data
3. **Machine Learning Integration**: Support for ML-based predictive algorithms and neural networks
4. **Advanced Risk Management**: Integrated position sizing, portfolio allocation, and risk controls
5. **Performance Analytics**: Enhanced metrics including Sharpe ratio, drawdown analysis, and win/loss ratios
6. **Algorithm Marketplace**: Community platform for sharing and discovering trading strategies

### Technical Improvements

7. **Multi-timeframe Analysis**: Support for analyzing multiple timeframes simultaneously
8. **Custom Indicators**: Framework for creating and integrating custom technical indicators
9. **Alert System**: Automated notifications for signal generation and algorithm status changes
10. **Mobile Optimization**: Enhanced mobile API endpoints for trading apps
11. **Cloud Scaling**: Auto-scaling execution for high-frequency algorithm processing
12. **A/B Testing**: Framework for comparing algorithm performance and optimization

## Performance Considerations

### Optimization Strategies

- **Data Caching**: Context building is cached for short periods to reduce database calls and improve response times
- **Parallel Processing**: Multiple algorithms can execute simultaneously for faster overall analysis
- **Memory Management**: Efficient handling of large price datasets to prevent memory leaks
- **Database Optimization**: Indexed queries and connection pooling for faster data retrieval

### Scalability Features

- **Execution Timeouts**: Prevent runaway algorithms from consuming excessive resources
- **Rate Limiting**: Control algorithm execution frequency to prevent system overload
- **Resource Monitoring**: Track CPU, memory, and database usage during algorithm execution
- **Load Balancing**: Distribute algorithm execution across multiple servers for high availability

### Production Monitoring

- **Health Checks**: Continuous monitoring of algorithm availability and execution status
- **Performance Metrics**: Track execution times, success rates, and resource consumption
- **Error Handling**: Comprehensive logging and alerting for algorithm failures
- **Graceful Degradation**: Fallback mechanisms when algorithms encounter errors or timeouts

### Recommended Limits

- **Execution Time**: Maximum 30 seconds per algorithm run
- **Memory Usage**: Limit to 512MB per algorithm instance
- **API Rate Limits**: Maximum 100 requests per minute per user
- **Data Retention**: Keep algorithm results for 90 days by default

This architecture provides a robust foundation for cryptocurrency trading algorithms while ensuring scalability, reliability, and maintainability for production environments.
```
