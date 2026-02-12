import { BacktestEngine, MarketData, Portfolio, TradingSignal } from './backtest-engine.service';
import { ReplaySpeed } from './backtest-pacing.interface';
import {
  FeeCalculatorService,
  MetricsCalculatorService,
  PortfolioStateService,
  PositionManagerService,
  SlippageModelType,
  SlippageService
} from './shared';

import { SignalType } from '../../algorithm/interfaces';
import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { DrawdownCalculator } from '../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';

// Create shared service instances for tests
const sharpeCalculator = new SharpeRatioCalculator();
const drawdownCalculator = new DrawdownCalculator();
const slippageService = new SlippageService();
const feeCalculator = new FeeCalculatorService();
const positionManager = new PositionManagerService();
const metricsCalculator = new MetricsCalculatorService(sharpeCalculator, drawdownCalculator);
const portfolioState = new PortfolioStateService();

describe('BacktestEngine.executeTrade', () => {
  const createEngine = () =>
    new BacktestEngine(
      {} as any, // backtestStream
      {} as any, // algorithmRegistry
      {} as any, // ohlcService
      {} as any, // marketDataReader
      {} as any, // quoteCurrencyResolver
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState
    );

  const createMarketData = (coinId: string, price: number): MarketData => ({
    timestamp: new Date(),
    prices: new Map([[coinId, price]])
  });

  const clonePortfolio = (portfolio: Portfolio): Portfolio => ({
    ...portfolio,
    positions: new Map(Array.from(portfolio.positions.entries()).map(([coinId, position]) => [coinId, { ...position }]))
  });

  const noSlippage = { type: SlippageModelType.NONE };

  it('calculates realized P&L for partial sells', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 0,
      totalValue: 100,
      positions: new Map([
        [
          'BTC',
          {
            coinId: 'BTC',
            quantity: 10,
            averagePrice: 10,
            totalValue: 100
          }
        ]
      ])
    };
    const random = () => 0.5;

    const sellSignal: TradingSignal = {
      action: 'SELL',
      coinId: 'BTC',
      quantity: 4,
      reason: 'take-profit',
      confidence: 1
    };

    const result = await (engine as any).executeTrade(
      sellSignal,
      portfolio,
      createMarketData('BTC', 15),
      0,
      random,
      noSlippage
    );

    expect(result).toBeTruthy();
    expect(result.trade.realizedPnL).toBeCloseTo(20);
    expect(result.trade.realizedPnLPercent).toBeCloseTo(0.5);
    expect(result.trade.costBasis).toBeCloseTo(10);

    const position = portfolio.positions.get('BTC');
    expect(position?.quantity).toBeCloseTo(6);
  });

  it('applies slippage and trading fees to BUY trades', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 200,
      totalValue: 200,
      positions: new Map()
    };

    const buySignal: TradingSignal = {
      action: 'BUY',
      coinId: 'BTC',
      quantity: 1,
      reason: 'entry',
      confidence: 0.8
    };

    const result = await (engine as any).executeTrade(
      buySignal,
      portfolio,
      createMarketData('BTC', 100),
      0.01,
      { next: () => 0.5 },
      { type: SlippageModelType.FIXED, fixedBps: 100 }
    );

    expect(result?.trade.price).toBeCloseTo(101);
    expect(result?.trade.fee).toBeCloseTo(1.01);
    expect(result?.trade.metadata?.basePrice).toBe(100);
    expect(result?.trade.metadata?.slippageBps).toBe(100);
    expect(portfolio.cashBalance).toBeCloseTo(97.99);
  });

  it('uses slippage-adjusted price for SELL realized P&L', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 0,
      totalValue: 80,
      positions: new Map([
        [
          'BTC',
          {
            coinId: 'BTC',
            quantity: 1,
            averagePrice: 80,
            totalValue: 80
          }
        ]
      ])
    };

    const sellSignal: TradingSignal = {
      action: 'SELL',
      coinId: 'BTC',
      quantity: 1,
      reason: 'exit',
      confidence: 1
    };

    const result = await (engine as any).executeTrade(
      sellSignal,
      portfolio,
      createMarketData('BTC', 100),
      0.01,
      { next: () => 0.5 },
      { type: SlippageModelType.FIXED, fixedBps: 100 }
    );

    expect(result?.trade.price).toBeCloseTo(99);
    // Note: Fee is no longer subtracted from realizedPnL (bug fix: fee only affects cashBalance)
    expect(result?.trade.realizedPnL).toBeCloseTo(19);
    expect(result?.trade.costBasis).toBeCloseTo(80);
  });

  it('returns null when market data has no price for the coin', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 100,
      totalValue: 100,
      positions: new Map()
    };

    const result = await (engine as any).executeTrade(
      { action: 'BUY', coinId: 'BTC', quantity: 1, reason: 'entry' },
      portfolio,
      { timestamp: new Date(), prices: new Map() },
      0,
      { next: () => 0.5 },
      noSlippage
    );

    expect(result).toBeNull();
    expect(portfolio.cashBalance).toBe(100);
  });

  describe('Bug Fix: Insufficient funds check includes fees', () => {
    it('rejects BUY when cash equals trade value but cannot cover fees', async () => {
      const engine = createEngine();
      // Cash exactly equals trade value (100), but not enough for fee (1%)
      const portfolio: Portfolio = {
        cashBalance: 100,
        totalValue: 100,
        positions: new Map()
      };

      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'BTC',
        quantity: 1,
        reason: 'entry'
      };

      const result = await (engine as any).executeTrade(
        buySignal,
        portfolio,
        createMarketData('BTC', 100),
        0.01, // 1% fee means we need 101 total
        { next: () => 0.5 },
        noSlippage
      );

      expect(result).toBeNull();
      expect(portfolio.cashBalance).toBe(100); // Unchanged
    });

    it('allows BUY when cash covers both trade value and fees', async () => {
      const engine = createEngine();
      // Cash = 101, trade = 100, fee = 1 (1%), total = 101
      const portfolio: Portfolio = {
        cashBalance: 101,
        totalValue: 101,
        positions: new Map()
      };

      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'BTC',
        quantity: 1,
        reason: 'entry'
      };

      const result = await (engine as any).executeTrade(
        buySignal,
        portfolio,
        createMarketData('BTC', 100),
        0.01, // 1% fee
        { next: () => 0.5 },
        noSlippage
      );

      expect(result).toBeTruthy();
      expect(portfolio.cashBalance).toBeCloseTo(0); // 101 - 100 - 1 = 0
    });
  });

  describe('Bug Fix: Volume passed to slippage calculation', () => {
    it('passes dailyVolume to slippage calculation', async () => {
      const engine = createEngine();
      const portfolio: Portfolio = {
        cashBalance: 10000,
        totalValue: 10000,
        positions: new Map()
      };

      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'BTC',
        quantity: 1,
        reason: 'entry'
      };

      // With volume-based slippage, higher volume = lower slippage
      const highVolumeResult = await (engine as any).executeTrade(
        buySignal,
        { ...portfolio, cashBalance: 10000, positions: new Map() },
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        { type: SlippageModelType.VOLUME_BASED, baseSlippageBps: 5, volumeImpactFactor: 100 },
        1000000000 // High volume
      );

      const lowVolumeResult = await (engine as any).executeTrade(
        buySignal,
        { ...portfolio, cashBalance: 10000, positions: new Map() },
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        { type: SlippageModelType.VOLUME_BASED, baseSlippageBps: 5, volumeImpactFactor: 100 },
        1000 // Low volume
      );

      // Higher volume should result in lower slippage (lower price for buy)
      expect(highVolumeResult?.trade.metadata?.slippageBps).toBeLessThan(lowVolumeResult?.trade.metadata?.slippageBps);
    });
  });

  describe('Bug Fix: SELL slippage estimation uses position quantity', () => {
    it('uses existing position quantity for SELL slippage estimation (percentage)', async () => {
      const engine = createEngine();
      // Large portfolio ($100,000) with small position (10 BTC @ $100 = $1,000)
      // Selling 50% should estimate slippage for 5 BTC, not $10,000 worth
      const portfolio: Portfolio = {
        cashBalance: 99000,
        totalValue: 100000,
        positions: new Map([
          [
            'BTC',
            {
              coinId: 'BTC',
              quantity: 10,
              averagePrice: 100,
              totalValue: 1000
            }
          ]
        ])
      };

      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: 'BTC',
        percentage: 0.5, // Sell 50% of position
        reason: 'partial exit'
      };

      // With volume-based slippage, the estimated quantity affects slippage calculation
      // A $10,000 estimate (10% of portfolio) vs 5 BTC estimate (50% of position)
      // would produce vastly different slippage in low-volume scenarios
      const result = await (engine as any).executeTrade(
        sellSignal,
        portfolio,
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        { type: SlippageModelType.VOLUME_BASED, baseSlippageBps: 5, volumeImpactFactor: 100 },
        10000 // $1M daily volume
      );

      expect(result).toBeTruthy();
      // Should sell 5 BTC (50% of 10)
      expect(result.trade.quantity).toBeCloseTo(5);
      // Slippage should be reasonable given 5 BTC * $100 = $500 vs $10k volume
      // Not inflated due to $10,000 (10% of $100k portfolio) estimate
      expect(result.trade.metadata?.slippageBps).toBeLessThanOrEqual(15);
    });

    it('calculates volume-based slippage correctly for SELL trades with no explicit quantity', async () => {
      const engine = createEngine();
      const portfolio: Portfolio = {
        cashBalance: 5000,
        totalValue: 10000,
        positions: new Map([
          [
            'BTC',
            {
              coinId: 'BTC',
              quantity: 50,
              averagePrice: 100,
              totalValue: 5000
            }
          ]
        ])
      };

      // SELL with no quantity specified - should use 50% of position (25 BTC) for slippage estimate
      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: 'BTC',
        reason: 'exit'
        // No quantity, percentage, or confidence - will use random
      };

      const lowVolumeResult = await (engine as any).executeTrade(
        sellSignal,
        clonePortfolio(portfolio),
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        { type: SlippageModelType.VOLUME_BASED, baseSlippageBps: 5, volumeImpactFactor: 100 },
        1000 // Low volume
      );

      const highVolumeResult = await (engine as any).executeTrade(
        sellSignal,
        clonePortfolio(portfolio),
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        { type: SlippageModelType.VOLUME_BASED, baseSlippageBps: 5, volumeImpactFactor: 100 },
        10000000 // High volume
      );

      // Higher volume should result in lower slippage
      expect(highVolumeResult?.trade.metadata?.slippageBps).toBeLessThan(lowVolumeResult?.trade.metadata?.slippageBps);
      expect(highVolumeResult?.trade.quantity).toBeCloseTo(25);
      expect(lowVolumeResult?.trade.quantity).toBeCloseTo(25);
    });

    it('deducts fee from cash balance on SELL trades', async () => {
      const engine = createEngine();
      const portfolio: Portfolio = {
        cashBalance: 0,
        totalValue: 1000,
        positions: new Map([['BTC', { coinId: 'BTC', quantity: 1, averagePrice: 100, totalValue: 100 }]])
      };

      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: 'BTC',
        quantity: 1,
        reason: 'exit'
      };

      const result = await (engine as any).executeTrade(
        sellSignal,
        portfolio,
        createMarketData('BTC', 200),
        0.01,
        { next: () => 0.5 },
        noSlippage
      );

      expect(result).toBeTruthy();
      // Proceeds 200, fee 2, cash should be 198
      expect(portfolio.cashBalance).toBeCloseTo(198);
      expect(result?.trade.fee).toBeCloseTo(2);
    });

    it('handles SELL with no existing position gracefully', async () => {
      const engine = createEngine();
      const portfolio: Portfolio = {
        cashBalance: 10000,
        totalValue: 10000,
        positions: new Map() // No positions
      };

      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: 'BTC',
        reason: 'exit'
      };

      const result = await (engine as any).executeTrade(
        sellSignal,
        portfolio,
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        { type: SlippageModelType.VOLUME_BASED, baseSlippageBps: 5, volumeImpactFactor: 100 },
        10000
      );

      // Should return null since there's no position to sell
      expect(result).toBeNull();
    });
  });

  describe('Bug Fix: Position sizing uses signal properties', () => {
    it('uses signal.percentage for BUY position sizing', async () => {
      const engine = createEngine();
      const portfolio: Portfolio = {
        cashBalance: 1000,
        totalValue: 1000,
        positions: new Map()
      };

      const buySignal: TradingSignal = {
        action: 'BUY',
        coinId: 'BTC',
        percentage: 0.1, // 10% of portfolio
        reason: 'entry'
      };

      const result = await (engine as any).executeTrade(
        buySignal,
        portfolio,
        createMarketData('BTC', 100),
        0,
        { next: () => 0.99 }, // Would use 20% if random was used
        noSlippage
      );

      // Should buy 100/100 = 1 BTC (10% of $1000)
      expect(result?.trade.quantity).toBeCloseTo(1);
      expect(result?.trade.totalValue).toBeCloseTo(100);
    });

    it('uses signal.confidence for BUY position sizing when percentage not set', async () => {
      const engine = createEngine();
      const portfolio: Portfolio = {
        cashBalance: 1000,
        totalValue: 1000,
        positions: new Map()
      };

      const highConfidenceSignal: TradingSignal = {
        action: 'BUY',
        coinId: 'BTC',
        confidence: 1.0, // Maximum confidence = 20% allocation
        reason: 'strong entry'
      };

      const lowConfidenceSignal: TradingSignal = {
        action: 'BUY',
        coinId: 'BTC',
        confidence: 0.0, // Minimum confidence = 5% allocation
        reason: 'weak entry'
      };

      const highResult = await (engine as any).executeTrade(
        highConfidenceSignal,
        { ...portfolio, cashBalance: 1000, positions: new Map() },
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        noSlippage
      );

      const lowResult = await (engine as any).executeTrade(
        lowConfidenceSignal,
        { ...portfolio, cashBalance: 1000, positions: new Map() },
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        noSlippage
      );

      // High confidence should invest more than low confidence
      expect(highResult?.trade.totalValue).toBeCloseTo(200); // 20% of $1000
      expect(lowResult?.trade.totalValue).toBeCloseTo(50); // 5% of $1000
    });

    it('uses signal.percentage for SELL position sizing', async () => {
      const engine = createEngine();
      const portfolio: Portfolio = {
        cashBalance: 0,
        totalValue: 1000,
        positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
      };

      const sellSignal: TradingSignal = {
        action: 'SELL',
        coinId: 'BTC',
        percentage: 0.5, // Sell 50% of position
        reason: 'partial exit'
      };

      const result = await (engine as any).executeTrade(
        sellSignal,
        portfolio,
        createMarketData('BTC', 100),
        0,
        { next: () => 0.99 }, // Would sell ~100% if random was used
        noSlippage
      );

      // Should sell 5 BTC (50% of 10)
      expect(result?.trade.quantity).toBeCloseTo(5);
    });

    it('uses signal.confidence for SELL position sizing when percentage not set', async () => {
      const engine = createEngine();

      const highConfidenceSignal: TradingSignal = {
        action: 'SELL',
        coinId: 'BTC',
        confidence: 1.0, // Maximum confidence = 100% of position
        reason: 'strong exit'
      };

      const lowConfidenceSignal: TradingSignal = {
        action: 'SELL',
        coinId: 'BTC',
        confidence: 0.0, // Minimum confidence = 25% of position
        reason: 'weak exit'
      };

      const highResult = await (engine as any).executeTrade(
        highConfidenceSignal,
        {
          cashBalance: 0,
          totalValue: 1000,
          positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
        },
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        noSlippage
      );

      const lowResult = await (engine as any).executeTrade(
        lowConfidenceSignal,
        {
          cashBalance: 0,
          totalValue: 1000,
          positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
        },
        createMarketData('BTC', 100),
        0,
        { next: () => 0.5 },
        noSlippage
      );

      // High confidence should sell 100%, low confidence should sell 25%
      expect(highResult?.trade.quantity).toBeCloseTo(10);
      expect(lowResult?.trade.quantity).toBeCloseTo(2.5);
    });
  });
});

describe('BacktestEngine mapStrategySignal: STOP_LOSS and TAKE_PROFIT', () => {
  const createEngine = (algorithmRegistry: any, ohlcService: any) =>
    new BacktestEngine(
      { publishMetric: jest.fn(), publishStatus: jest.fn() } as any,
      algorithmRegistry,
      ohlcService,
      { hasStorageLocation: jest.fn().mockReturnValue(false) } as any,
      { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) } as any,
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState
    );

  const createCandles = (coinId: string) => [
    new OHLCCandle({
      coinId,
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      open: 100,
      high: 110,
      low: 90,
      close: 100,
      volume: 1000
    }),
    new OHLCCandle({
      coinId,
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T01:00:00.000Z'),
      open: 100,
      high: 110,
      low: 90,
      close: 100,
      volume: 1000
    })
  ];

  it('maps STOP_LOSS signals to SELL and produces trades', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          signals: [
            { type: SignalType.BUY, coinId: 'BTC', quantity: 1, strength: 0.5, reason: 'entry', confidence: 0.8 }
          ]
        })
        .mockResolvedValueOnce({
          success: true,
          signals: [
            {
              type: SignalType.STOP_LOSS,
              coinId: 'BTC',
              quantity: 1,
              strength: 0.8,
              reason: 'stop triggered',
              confidence: 0.9
            }
          ]
        })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles('BTC')) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-stop-loss',
        name: 'STOP_LOSS Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-1',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-stop-loss'
      }
    );

    // Should have 2 trades: BUY + SELL (from STOP_LOSS)
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].type).toBe('BUY');
    expect(result.trades[1].type).toBe('SELL');
    expect(result.signals).toHaveLength(2);
  });

  it('maps TAKE_PROFIT signals to SELL and produces trades', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          signals: [
            { type: SignalType.BUY, coinId: 'BTC', quantity: 1, strength: 0.5, reason: 'entry', confidence: 0.8 }
          ]
        })
        .mockResolvedValueOnce({
          success: true,
          signals: [
            {
              type: SignalType.TAKE_PROFIT,
              coinId: 'BTC',
              quantity: 1,
              strength: 0.8,
              reason: 'target reached',
              confidence: 0.9
            }
          ]
        })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles('BTC')) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-take-profit',
        name: 'TAKE_PROFIT Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-2',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-take-profit'
      }
    );

    // Should have 2 trades: BUY + SELL (from TAKE_PROFIT)
    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].type).toBe('BUY');
    expect(result.trades[1].type).toBe('SELL');
    expect(result.signals).toHaveLength(2);
  });
});

describe('BacktestEngine.executeOptimizationBacktest', () => {
  const createEngine = (algorithmRegistry: any, ohlcService: any) =>
    new BacktestEngine(
      {} as any, // backtestStream
      algorithmRegistry,
      ohlcService,
      {} as any, // marketDataReader
      {} as any, // quoteCurrencyResolver
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState
    );

  it('rethrows AlgorithmNotRegisteredException', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockRejectedValue(new AlgorithmNotRegisteredException('algo-1'))
    };
    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-02T00:00:00.000Z');
    const candle = new OHLCCandle({
      coinId: 'coin-1',
      exchangeId: 'exchange-1',
      timestamp: startDate,
      open: 100,
      high: 110,
      low: 90,
      close: 105,
      volume: 1000
    });
    const ohlcService = {
      getCandlesByDateRange: jest.fn().mockResolvedValue([candle])
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const config = {
      algorithmId: 'algo-1',
      parameters: {},
      startDate,
      endDate
    };

    await expect(engine.executeOptimizationBacktest(config, [{ id: 'coin-1' }] as any)).rejects.toBeInstanceOf(
      AlgorithmNotRegisteredException
    );
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledWith(
      'algo-1',
      expect.objectContaining({
        config: {},
        metadata: expect.objectContaining({ isOptimization: true, algorithmId: 'algo-1' })
      })
    );
  });

  it('returns neutral metrics when there is no price data', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn()
    };
    const ohlcService = {
      getCandlesByDateRange: jest.fn().mockResolvedValue([])
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeOptimizationBacktest(
      {
        algorithmId: 'algo-1',
        parameters: {},
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-02T00:00:00.000Z')
      },
      [{ id: 'coin-1' }] as any
    );

    expect(result).toEqual(
      expect.objectContaining({
        sharpeRatio: 0,
        totalReturn: 0,
        maxDrawdown: 0,
        winRate: 0,
        volatility: 0,
        profitFactor: 1,
        tradeCount: 0
      })
    );
    expect(algorithmRegistry.executeAlgorithm).not.toHaveBeenCalled();
  });

  it('returns annualized return and final value when price data exists', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };
    const ohlcService = {
      getCandlesByDateRange: jest.fn()
    };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const startDate = new Date('2024-01-01T00:00:00.000Z');
    const endDate = new Date('2024-01-03T00:00:00.000Z');
    const candles = [
      new OHLCCandle({
        coinId: 'coin-1',
        exchangeId: 'exchange-1',
        timestamp: startDate,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'coin-1',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
        open: 105,
        high: 115,
        low: 95,
        close: 110,
        volume: 1000
      })
    ];

    jest.spyOn(engine as any, 'getHistoricalPrices').mockResolvedValue(candles);

    const result = await engine.executeOptimizationBacktest(
      {
        algorithmId: 'algo-1',
        parameters: { foo: 'bar' },
        startDate,
        endDate,
        initialCapital: 10000,
        tradingFee: 0.001
      },
      [{ id: 'coin-1' }] as any
    );

    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledWith(
      'algo-1',
      expect.objectContaining({
        config: { foo: 'bar' },
        metadata: expect.objectContaining({ isOptimization: true, algorithmId: 'algo-1' })
      })
    );
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
    expect(result.finalValue).toBeCloseTo(10000);
    expect(result.totalReturn).toBe(0);
    expect(result.annualizedReturn).toBe(0);
    expect(result.tradeCount).toBe(0);
    expect(result.profitFactor).toBe(1);
  });
});

describe('BacktestEngine.executeLiveReplayBacktest', () => {
  const createEngine = (deps: {
    algorithmRegistry: any;
    marketDataReader: any;
    ohlcService: any;
    quoteCurrencyResolver: any;
  }) =>
    new BacktestEngine(
      { publishMetric: jest.fn(), publishStatus: jest.fn() } as any,
      deps.algorithmRegistry,
      deps.ohlcService,
      deps.marketDataReader,
      deps.quoteCurrencyResolver,
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState
    );

  const createCandles = () => [
    new OHLCCandle({
      coinId: 'BTC',
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      open: 100,
      high: 110,
      low: 90,
      close: 100,
      volume: 1000
    }),
    new OHLCCandle({
      coinId: 'BTC',
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T01:00:00.000Z'),
      open: 100,
      high: 110,
      low: 90,
      close: 100,
      volume: 1000
    })
  ];

  it('pauses and returns a checkpoint when shouldPause resolves true', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const shouldPause = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onPaused = jest.fn().mockResolvedValue(undefined);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-1',
        name: 'Live Replay',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-1',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-1',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause,
        onPaused
      }
    );

    expect(result.paused).toBe(true);
    expect(result.pausedCheckpoint?.lastProcessedIndex).toBe(0);
    expect(result.snapshots).toHaveLength(1);
    expect(onPaused).toHaveBeenCalledTimes(1);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(1);
  });

  it('emits checkpoint results with incremental slices', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          signals: [
            {
              type: SignalType.BUY,
              coinId: 'BTC',
              quantity: 1,
              reason: 'entry'
            }
          ]
        })
        .mockResolvedValueOnce({ success: true, signals: [] })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const onCheckpoint = jest.fn().mockResolvedValue(undefined);

    await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-2',
        name: 'Checkpoint Replay',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-2',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-2',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1,
        onCheckpoint
      }
    );

    expect(onCheckpoint).toHaveBeenCalled();
    const [, firstResults, totalTimestamps] = onCheckpoint.mock.calls[0];
    expect(totalTimestamps).toBe(2);
    expect(firstResults.trades).toHaveLength(1);
    expect(firstResults.signals).toHaveLength(1);
    expect(firstResults.simulatedFills).toHaveLength(1);
    expect(firstResults.snapshots).toHaveLength(1);
  });

  it('continues execution when pause check fails transiently', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Pause check fails once but then succeeds
    const shouldPause = jest.fn().mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue(false);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-transient',
        name: 'Transient Failure Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-transient',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-transient',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause
      }
    );

    // Should complete normally despite transient failure
    expect(result.paused).toBe(false);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('forces precautionary pause after 3 consecutive pause check failures', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    // Create more candles so we have enough iterations for 3 failures
    const candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 90,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T01:00:00.000Z'),
        open: 100,
        high: 110,
        low: 90,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T02:00:00.000Z'),
        open: 100,
        high: 110,
        low: 90,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T03:00:00.000Z'),
        open: 100,
        high: 110,
        low: 90,
        close: 100,
        volume: 1000
      })
    ];

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Pause check fails 3 times consecutively (threshold)
    const shouldPause = jest.fn().mockRejectedValue(new Error('Redis unavailable'));
    const onPaused = jest.fn().mockResolvedValue(undefined);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-consecutive-fail',
        name: 'Consecutive Failure Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T04:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-fail',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T04:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-fail',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause,
        onPaused
      }
    );

    // Should force pause after 3 consecutive failures
    expect(result.paused).toBe(true);
    expect(onPaused).toHaveBeenCalledTimes(1);
    // Should have processed fewer timestamps than available
    expect(algorithmRegistry.executeAlgorithm.mock.calls.length).toBeLessThan(4);
  });

  it('resets pause failure counter on successful pause check', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    // Create 5 candles
    const candles = [1, 2, 3, 4, 5].map(
      (i) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-01T0${i - 1}:00:00.000Z`),
          open: 100,
          high: 110,
          low: 90,
          close: 100,
          volume: 1000
        })
    );

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Fail twice, succeed, fail twice again - should NOT trigger precautionary pause
    const shouldPause = jest
      .fn()
      .mockRejectedValueOnce(new Error('Redis error'))
      .mockRejectedValueOnce(new Error('Redis error'))
      .mockResolvedValueOnce(false) // Success resets counter
      .mockRejectedValueOnce(new Error('Redis error'))
      .mockResolvedValueOnce(false);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-reset-counter',
        name: 'Reset Counter Test',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T05:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-reset',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T05:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-reset',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        shouldPause
      }
    );

    // Should complete normally since counter resets on success
    expect(result.paused).toBe(false);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(5);
  });
});

describe('BacktestEngine checkpointing', () => {
  const createEngine = () =>
    new BacktestEngine(
      {} as any, // backtestStream
      {} as any, // algorithmRegistry
      {} as any, // ohlcService
      {} as any, // marketDataReader
      {} as any, // quoteCurrencyResolver
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState
    );

  const createCheckpoint = (engine: BacktestEngine) => {
    const portfolio: Portfolio = {
      cashBalance: 1000,
      totalValue: 1200,
      positions: new Map([
        [
          'BTC',
          {
            coinId: 'BTC',
            quantity: 2,
            averagePrice: 100,
            totalValue: 200
          }
        ]
      ])
    };

    return (engine as any).buildCheckpointState(1, '2024-01-02T00:00:00.000Z', portfolio, 1250, 0.1, 12345, 2, 3, 4, 5);
  };

  it('validates checkpoints with matching checksum', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);

    const result = engine.validateCheckpoint(checkpoint, [
      '2024-01-01T00:00:00.000Z',
      '2024-01-02T00:00:00.000Z',
      '2024-01-03T00:00:00.000Z'
    ]);

    expect(result).toEqual({ valid: true });
  });

  it('detects corrupted checkpoints via checksum', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);
    checkpoint.portfolio.cashBalance += 10;

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z', '2024-01-02T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('checksum');
  });

  it('rejects checkpoints with timestamp mismatches', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z', '2024-01-04T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Timestamp mismatch');
  });

  it('rejects checkpoints that are out of bounds', () => {
    const engine = createEngine();
    const checkpoint = createCheckpoint(engine);
    checkpoint.lastProcessedIndex = 5;

    const result = engine.validateCheckpoint(checkpoint, ['2024-01-01T00:00:00.000Z']);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('out of bounds');
  });

  it('restores portfolio state from checkpoint data', () => {
    const checkpoint = createCheckpoint(createEngine());

    // Use shared portfolioState service directly since BacktestEngine delegates to it
    const restored = portfolioState.deserialize(checkpoint.portfolio);

    expect(restored.cashBalance).toBe(1000);
    expect(restored.positions.size).toBe(1);
    expect(restored.positions.get('BTC')).toEqual(
      expect.objectContaining({
        coinId: 'BTC',
        quantity: 2,
        averagePrice: 100,
        totalValue: 200
      })
    );
    expect(restored.totalValue).toBe(1200);
  });
});
