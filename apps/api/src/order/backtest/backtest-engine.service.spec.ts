import { CompositeRegimeType } from '@chansey/api-interfaces';

import { BacktestEngine, MarketData, Portfolio, TradingSignal } from './backtest-engine.service';
import { ReplaySpeed } from './backtest-pacing.interface';
import {
  FeeCalculatorService,
  MetricsCalculatorService,
  PortfolioStateService,
  PositionManagerService,
  SignalThrottleService,
  SlippageModelType,
  SlippageService
} from './shared';

import { SignalType } from '../../algorithm/interfaces';
import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { DrawdownCalculator } from '../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { RegimeGateService } from '../../market-regime/regime-gate.service';
import { VolatilityCalculator } from '../../market-regime/volatility.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { PositionAnalysisService } from '../services/position-analysis.service';

const positionAnalysis = new PositionAnalysisService();

// Create shared service instances for tests
const sharpeCalculator = new SharpeRatioCalculator();
const drawdownCalculator = new DrawdownCalculator();
const slippageService = new SlippageService();
const feeCalculator = new FeeCalculatorService();
const positionManager = new PositionManagerService();
const metricsCalculator = new MetricsCalculatorService(sharpeCalculator, drawdownCalculator);
const portfolioState = new PortfolioStateService();
const signalThrottle = new SignalThrottleService();
const regimeGateService = new RegimeGateService();
const volatilityCalculator = new VolatilityCalculator();

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
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
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
      { next: () => 0.5 },
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
        confidence: 1.0, // Maximum confidence = 12% allocation
        reason: 'strong entry'
      };

      const lowConfidenceSignal: TradingSignal = {
        action: 'BUY',
        coinId: 'BTC',
        confidence: 0.0, // Minimum confidence = 3% allocation
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
      expect(highResult?.trade.totalValue).toBeCloseTo(120); // 12% of $1000
      expect(lowResult?.trade.totalValue).toBeCloseTo(30); // 3% of $1000
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

  describe('Min hold period enforcement', () => {
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
    const entryDate = new Date('2024-01-01T00:00:00.000Z');

    const createHeldPortfolio = (): Portfolio => ({
      cashBalance: 0,
      totalValue: 1000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000, entryDate }]])
    });

    it('rejects SELL when position held less than minHoldMs', async () => {
      const engine = createEngine();
      const portfolio = createHeldPortfolio();
      // 12 hours after entry — within the 24h default hold period
      const sellTimestamp = new Date('2024-01-01T12:00:00.000Z');

      const result = await (engine as any).executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 5, reason: 'exit' },
        portfolio,
        { timestamp: sellTimestamp, prices: new Map([['BTC', 120]]) },
        0,
        { next: () => 0.5 },
        noSlippage,
        undefined,
        TWENTY_FOUR_HOURS_MS
      );

      expect(result).toBeNull();
      expect(portfolio.positions.get('BTC')?.quantity).toBe(10); // Unchanged
    });

    it.each([
      { type: SignalType.STOP_LOSS, label: 'STOP_LOSS' },
      { type: SignalType.TAKE_PROFIT, label: 'TAKE_PROFIT' }
    ])('allows $label SELL even within min hold period', async ({ type }) => {
      const engine = createEngine();
      const portfolio = createHeldPortfolio();
      // 1 hour after entry — well within the 24h hold period
      const sellTimestamp = new Date('2024-01-01T01:00:00.000Z');

      const result = await (engine as any).executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 10, reason: 'risk exit', originalType: type },
        portfolio,
        { timestamp: sellTimestamp, prices: new Map([['BTC', 80]]) },
        0,
        { next: () => 0.5 },
        noSlippage,
        undefined,
        TWENTY_FOUR_HOURS_MS
      );

      expect(result).toBeTruthy();
      expect(result.trade.quantity).toBe(10);
    });

    it('allows SELL after min hold period has elapsed', async () => {
      const engine = createEngine();
      const portfolio = createHeldPortfolio();
      // 25 hours after entry — beyond the 24h hold period
      const sellTimestamp = new Date('2024-01-02T01:00:00.000Z');

      const result = await (engine as any).executeTrade(
        { action: 'SELL', coinId: 'BTC', quantity: 5, reason: 'exit' },
        portfolio,
        { timestamp: sellTimestamp, prices: new Map([['BTC', 120]]) },
        0,
        { next: () => 0.5 },
        noSlippage,
        undefined,
        TWENTY_FOUR_HOURS_MS
      );

      expect(result).toBeTruthy();
      expect(result.trade.quantity).toBe(5);
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
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
    );

  const createCandles = (coinId: string) => [
    new OHLCCandle({
      coinId,
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
      close: 100,
      volume: 1000
    }),
    new OHLCCandle({
      coinId,
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T01:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
      close: 100,
      volume: 1000
    })
  ];

  it.each([
    { signalType: SignalType.STOP_LOSS, reason: 'stop triggered', label: 'STOP_LOSS' },
    { signalType: SignalType.TAKE_PROFIT, reason: 'target reached', label: 'TAKE_PROFIT' }
  ])('maps $label signals to SELL and produces trades', async ({ signalType, reason, label }) => {
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
          signals: [{ type: signalType, coinId: 'BTC', quantity: 1, strength: 0.8, reason, confidence: 0.9 }]
        })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles('BTC')) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: `bt-${label.toLowerCase()}`,
        name: `${label} Test`,
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
          id: `dataset-${label.toLowerCase()}`,
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: `seed-${label.toLowerCase()}`
      }
    );

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
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
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
      low: 96,
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
        low: 96,
        close: 105,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'coin-1',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-02T00:00:00.000Z'),
        open: 105,
        high: 115,
        low: 96,
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
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
    );

  const createCandles = () => [
    new OHLCCandle({
      coinId: 'BTC',
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T00:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
      close: 100,
      volume: 1000
    }),
    new OHLCCandle({
      coinId: 'BTC',
      exchangeId: 'exchange-1',
      timestamp: new Date('2024-01-01T01:00:00.000Z'),
      open: 100,
      high: 110,
      low: 96,
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
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T01:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T02:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T03:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
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
          low: 96,
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

  it('includes cumulative counts in pause checkpoint after prior checkpoints', async () => {
    // Regression test for C1: pause paths must use cumulative counts, not just
    // the current (post-clear) array lengths, so that resume sees all trades.
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
      })
    };

    // 4 candles → 4 iterations: checkpoint fires after iteration 0, then pause at iteration 2
    const candles = [0, 1, 2, 3].map(
      (i) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-01T0${i}:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = {
      resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' })
    };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const onCheckpoint = jest.fn().mockResolvedValue(undefined);
    // Pause after 3 iterations (indices 0, 1, 2 processed, pause check at start of index 3)
    const shouldPause = jest
      .fn()
      .mockResolvedValueOnce(false) // i=0
      .mockResolvedValueOnce(false) // i=1
      .mockResolvedValueOnce(false) // i=2
      .mockResolvedValueOnce(true); // i=3 → pause

    const onPaused = jest.fn().mockResolvedValue(undefined);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-c1-regression',
        name: 'C1 Regression',
        initialCapital: 100000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T04:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: { cooldownMs: 0, maxTradesPerDay: 0 } }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-c1',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T04:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-c1',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1, // checkpoint after every iteration
        onCheckpoint,
        shouldPause,
        onPaused
      }
    );

    expect(result.paused).toBe(true);
    expect(onPaused).toHaveBeenCalledTimes(1);

    // Verify pause checkpoint has cumulative counts, not just partial
    const pausedCheckpoint = result.pausedCheckpoint!;
    // Each iteration produces 1 trade (BUY signal always fires), so after 3 iterations → 3 trades
    // With checkpointInterval=1, arrays get cleared at checkpoints.
    // The bug was that pause used trades.length (partial) instead of totalPersistedCounts + trades.length (cumulative)
    expect(pausedCheckpoint.persistedCounts.trades).toBe(3);

    // Sells and winningSells should be persisted (all BUY signals → 0 sells)
    expect(pausedCheckpoint.persistedCounts.sells).toBe(0);
    expect(pausedCheckpoint.persistedCounts.winningSells).toBe(0);

    // Final metrics should also reflect all trades across checkpoints
    expect(result.finalMetrics.totalTrades).toBe(3);
  });

  it('persists cumulative sell/winningSell counts across checkpoints for accurate resume winRate', async () => {
    // Regression test: sell counts must survive checkpoint+resume for correct winRate.
    // Iteration 0: BUY 1 BTC @ 100 → position opened
    // Iteration 1: SELL 1 BTC @ 120 → winning sell (realizedPnL = 20)
    // Iteration 2: BUY 1 BTC @ 120
    // Iteration 3: SELL 1 BTC @ 110 → losing sell (realizedPnL = -10)
    // With checkpointInterval=1, arrays are cleared after each checkpoint.
    // Without the fix, resume would lose sell counts from earlier checkpoints.
    let callCount = 0;
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Iteration 0: BUY
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (callCount === 2) {
          // Iteration 1: SELL (winning)
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'take-profit', confidence: 1 }]
          });
        } else if (callCount === 3) {
          // Iteration 2: BUY again
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (callCount === 4) {
          // Iteration 3: SELL (losing)
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'exit', confidence: 1 }]
          });
        }
        return Promise.resolve({ success: true, signals: [] });
      })
    };

    // Prices: 100, 120, 120, 110 → first sell wins, second sell loses
    // Timestamps spaced 25h apart so positions satisfy min hold period (24h)
    const candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-02T01:00:00.000Z'),
        open: 100,
        high: 130,
        low: 96,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-03T02:00:00.000Z'),
        open: 120,
        high: 125,
        low: 115,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-04T03:00:00.000Z'),
        open: 120,
        high: 120,
        low: 105,
        close: 110,
        volume: 1000
      })
    ];

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    const capturedCheckpoints: any[] = [];
    const onCheckpoint = jest.fn().mockImplementation((state) => {
      capturedCheckpoints.push(JSON.parse(JSON.stringify(state)));
      return Promise.resolve();
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-sell-counts',
        name: 'Sell Count Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-05T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-sells',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-05T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-sells',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1,
        onCheckpoint
      }
    );

    expect(result.paused).toBe(false);

    // After iteration 1 (BUY + SELL winning): should have 1 sell, 1 winning sell
    const cp1 = capturedCheckpoints.find((cp) => cp.persistedCounts.sells >= 1);
    expect(cp1).toBeDefined();
    expect(cp1.persistedCounts.sells).toBe(1);
    expect(cp1.persistedCounts.winningSells).toBe(1);

    // Final metrics should reflect 2 sells total, 1 winning → winRate = 0.5
    expect(result.finalMetrics.totalTrades).toBe(4); // 2 buys + 2 sells
    expect(result.finalMetrics.winRate).toBeCloseTo(0.5); // 1 winning / 2 sells
    expect(result.finalMetrics.winningTrades).toBe(1);
  });

  it('restores sell/winning sell counts on resume for accurate winRate', async () => {
    // Simulate a backtest that was checkpointed with known sell counts,
    // then resumed with additional trades. The final winRate must reflect
    // the full run, not just the resumed portion.

    // Phase 1: Run 2 iterations (BUY then winning SELL), capture checkpoint
    let phase1CallCount = 0;
    const phase1Registry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        phase1CallCount++;
        if (phase1CallCount === 1) {
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (phase1CallCount === 2) {
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'take-profit', confidence: 1 }]
          });
        }
        return Promise.resolve({ success: true, signals: [] });
      })
    };

    // Timestamps spaced 25h apart so positions satisfy min hold period (24h)
    const phase1Candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-02T01:00:00.000Z'),
        open: 100,
        high: 130,
        low: 96,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-03T02:00:00.000Z'),
        open: 120,
        high: 125,
        low: 115,
        close: 120,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'e1',
        timestamp: new Date('2024-01-04T03:00:00.000Z'),
        open: 120,
        high: 120,
        low: 105,
        close: 110,
        volume: 1000
      })
    ];

    const ohlcService1 = { getCandlesByDateRange: jest.fn().mockResolvedValue(phase1Candles) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine1 = createEngine({
      algorithmRegistry: phase1Registry,
      marketDataReader,
      ohlcService: ohlcService1,
      quoteCurrencyResolver
    });

    // Pause after 2 iterations to capture checkpoint with 1 winning sell
    const shouldPause = jest
      .fn()
      .mockResolvedValueOnce(false) // i=0 BUY
      .mockResolvedValueOnce(false) // i=1 SELL
      .mockResolvedValueOnce(true); // i=2 → pause

    const onPaused = jest.fn().mockResolvedValue(undefined);
    const onCheckpoint = jest.fn().mockResolvedValue(undefined);

    const phase1Result = await engine1.executeLiveReplayBacktest(
      {
        id: 'backtest-resume-winrate',
        name: 'Resume WinRate',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-05T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-resume',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-05T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-resume',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        checkpointInterval: 1,
        onCheckpoint,
        shouldPause,
        onPaused
      }
    );

    expect(phase1Result.paused).toBe(true);
    const checkpoint = phase1Result.pausedCheckpoint!;
    // Phase 1: 1 BUY + 1 SELL (winning) → sells=1, winningSells=1
    expect(checkpoint.persistedCounts.sells).toBe(1);
    expect(checkpoint.persistedCounts.winningSells).toBe(1);

    // Phase 2: Resume from checkpoint. Iterations 2,3 → BUY then losing SELL
    let phase2CallCount = 0;
    const phase2Registry = {
      executeAlgorithm: jest.fn().mockImplementation(() => {
        phase2CallCount++;
        if (phase2CallCount === 1) {
          // Iteration 2: BUY
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
          });
        } else if (phase2CallCount === 2) {
          // Iteration 3: SELL (losing, price dropped from 120 → 110)
          return Promise.resolve({
            success: true,
            signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 1, reason: 'exit', confidence: 1 }]
          });
        }
        return Promise.resolve({ success: true, signals: [] });
      })
    };

    const ohlcService2 = { getCandlesByDateRange: jest.fn().mockResolvedValue(phase1Candles) };
    const engine2 = createEngine({
      algorithmRegistry: phase2Registry,
      marketDataReader,
      ohlcService: ohlcService2,
      quoteCurrencyResolver
    });

    const phase2Result = await engine2.executeLiveReplayBacktest(
      {
        id: 'backtest-resume-winrate',
        name: 'Resume WinRate',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-05T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-resume',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-05T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-resume',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        resumeFrom: checkpoint
      }
    );

    expect(phase2Result.paused).toBe(false);
    // Full run: 2 sells total (1 winning from phase 1 + 1 losing from phase 2)
    // winRate should be 1/2 = 0.5, NOT 0/1 = 0 (which would happen without the fix)
    expect(phase2Result.finalMetrics.winRate).toBeCloseTo(0.5);
    expect(phase2Result.finalMetrics.winningTrades).toBe(1);
    // Total trades: 2 from phase 1 (persisted) + 2 from phase 2 = 4
    expect(phase2Result.finalMetrics.totalTrades).toBe(4);
  });

  it('blocks BUY signals in BEAR regime by default (regime gate on)', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
      })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Spy on computeCompositeRegime to return BEAR regime
    jest.spyOn(engine as any, 'computeCompositeRegime').mockReturnValue({
      compositeRegime: CompositeRegimeType.BEAR
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-regime-gate',
        name: 'Regime Gate Test',
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
          id: 'dataset-regime',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-regime',
        replaySpeed: ReplaySpeed.MAX_SPEED
        // enableRegimeGate defaults to true
      }
    );

    // BUY signals should be filtered out in BEAR regime — no trades executed
    expect(result.trades).toHaveLength(0);
    // Signals are still recorded (filtering happens after signal recording in the throttle step,
    // but the mapped trading signals are filtered before trade execution)
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('allows BUY signals through in BEAR regime when enableRegimeGate is false', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 1, reason: 'entry', confidence: 0.8 }]
      })
    };
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(createCandles()) };
    const marketDataReader = { hasStorageLocation: jest.fn().mockReturnValue(false) };
    const quoteCurrencyResolver = { resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) };

    const engine = createEngine({ algorithmRegistry, marketDataReader, ohlcService, quoteCurrencyResolver });

    // Spy on computeCompositeRegime to return BEAR regime
    jest.spyOn(engine as any, 'computeCompositeRegime').mockReturnValue({
      compositeRegime: CompositeRegimeType.BEAR
    });

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'backtest-no-gate',
        name: 'Regime Gate Disabled Test',
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
          id: 'dataset-no-gate',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-no-gate',
        replaySpeed: ReplaySpeed.MAX_SPEED,
        enableRegimeGate: false
      }
    );

    // BUY signals should NOT be filtered when regime gate is disabled — trades should execute
    expect(result.trades.length).toBeGreaterThan(0);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
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
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
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

    return (engine as any).buildCheckpointState(
      1,
      '2024-01-02T00:00:00.000Z',
      portfolio,
      1250,
      0.1,
      12345,
      2,
      3,
      4,
      5,
      0,
      0
    );
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

describe('BacktestEngine warmup / date range separation', () => {
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
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
    );

  it('does not trade before backtest.startDate when dataset is broader', async () => {
    // Dataset: Jan 1-4, Backtest trading window: Jan 3-4
    // Jan 1-2 should be warmup only (no trades/signals)
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
      })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-warmup',
        name: 'Warmup Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'), // Trading starts Jan 3
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-warmup',
          startAt: new Date('2024-01-01T00:00:00.000Z'), // Dataset starts Jan 1
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-warmup'
      }
    );

    // Should only have trades from Jan 3 and Jan 4 (2 trading periods)
    expect(result.trades).toHaveLength(2);
    for (const trade of result.trades) {
      expect((trade.executedAt as Date).getTime()).toBeGreaterThanOrEqual(
        new Date('2024-01-03T00:00:00.000Z').getTime()
      );
    }

    // Algorithm is called for all 4 timestamps (2 warmup + 2 trading)
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(4);
  });

  it('produces no snapshots during warmup period', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-no-warmup-snap',
        name: 'No Warmup Snapshots',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'),
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-no-snap',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-no-snap'
      }
    );

    // All snapshots should be within the trading window
    for (const snapshot of result.snapshots) {
      expect((snapshot.timestamp as Date).getTime()).toBeGreaterThanOrEqual(
        new Date('2024-01-03T00:00:00.000Z').getTime()
      );
    }
  });

  it('does not trade after backtest.endDate even if dataset extends further', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
      })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-end-trim',
        name: 'End Date Trim',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-02T00:00:00.000Z'), // End before dataset ends
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-end-trim',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z') // Dataset extends to Jan 4
        } as any,
        deterministicSeed: 'seed-end-trim'
      }
    );

    // Should only have trades from Jan 1 and Jan 2
    expect(result.trades).toHaveLength(2);
    for (const trade of result.trades) {
      expect((trade.executedAt as Date).getTime()).toBeLessThanOrEqual(new Date('2024-01-02T00:00:00.000Z').getTime());
    }
  });

  it('behaves identically when dataset and backtest dates match', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
      })
    };

    const candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T01:00:00.000Z'),
        open: 100,
        high: 110,
        low: 96,
        close: 100,
        volume: 1000
      })
    ];
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'bt-matching',
        name: 'Matching Dates',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00.000Z'),
        endDate: new Date('2024-01-01T02:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: { cooldownMs: 0, maxTradesPerDay: 0 } }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-matching',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-01T02:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-matching'
      }
    );

    // No warmup, all periods are trading — 2 trades expected
    expect(result.trades).toHaveLength(2);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
  });

  it('reports progress relative to trading period in checkpoints', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
      })
    };

    // 4 candles: 2 warmup + 2 trading
    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const engine = createEngine(algorithmRegistry, ohlcService);

    const onCheckpoint = jest.fn().mockResolvedValue(undefined);

    await engine.executeHistoricalBacktest(
      {
        id: 'bt-progress',
        name: 'Progress Test',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'),
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-progress',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-progress',
        checkpointInterval: 1,
        onCheckpoint
      }
    );

    // Checkpoint totalTimestamps should reflect trading period (2), not full dataset (4)
    if (onCheckpoint.mock.calls.length > 0) {
      const [, , totalTimestamps] = onCheckpoint.mock.calls[0];
      expect(totalTimestamps).toBe(2);
    }
  });

  it('live replay: no trades before backtest.startDate with broader dataset', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: true,
        signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 0.1, reason: 'entry', confidence: 0.5 }]
      })
    };

    const candles = [1, 2, 3, 4].map(
      (day) =>
        new OHLCCandle({
          coinId: 'BTC',
          exchangeId: 'exchange-1',
          timestamp: new Date(`2024-01-0${day}T00:00:00.000Z`),
          open: 100,
          high: 110,
          low: 96,
          close: 100,
          volume: 1000
        })
    );
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };

    const engine = createEngine(algorithmRegistry, ohlcService);

    const result = await engine.executeLiveReplayBacktest(
      {
        id: 'bt-live-warmup',
        name: 'Live Replay Warmup',
        initialCapital: 10000,
        tradingFee: 0,
        startDate: new Date('2024-01-03T00:00:00.000Z'),
        endDate: new Date('2024-01-04T00:00:00.000Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: { parameters: {} }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        dataset: {
          id: 'dataset-live-warmup',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-04T00:00:00.000Z')
        } as any,
        deterministicSeed: 'seed-live-warmup',
        replaySpeed: ReplaySpeed.MAX_SPEED
      }
    );

    // Should only have trades from Jan 3 and Jan 4
    expect(result.trades).toHaveLength(2);
    for (const trade of result.trades) {
      expect((trade.executedAt as Date).getTime()).toBeGreaterThanOrEqual(
        new Date('2024-01-03T00:00:00.000Z').getTime()
      );
    }
    expect(result.paused).toBe(false);
  });
});

describe('BacktestEngine hard stop-loss', () => {
  const createEngine = () =>
    new BacktestEngine(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
    );

  const noSlippage = { type: SlippageModelType.NONE };

  it('generateHardStopLossSignals emits SELL when loss exceeds threshold', () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 5000,
      totalValue: 10000,
      positions: new Map([
        ['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }],
        ['ETH', { coinId: 'ETH', quantity: 5, averagePrice: 200, totalValue: 1000 }]
      ])
    };

    // BTC dropped from 100 → 90 (-10%), ETH at 195 (-2.5%)
    const prices = new Map([
      ['BTC', 90],
      ['ETH', 195]
    ]);

    const signals = (engine as any).generateHardStopLossSignals(portfolio, prices, 0.05);

    // Only BTC should trigger (10% > 5% threshold), ETH is within threshold
    expect(signals).toHaveLength(1);
    expect(signals[0].coinId).toBe('BTC');
    expect(signals[0].action).toBe('SELL');
    expect(signals[0].quantity).toBe(10); // 100% exit
    expect(signals[0].originalType).toBe(SignalType.STOP_LOSS);
    expect(signals[0].metadata?.hardStopLoss).toBe(true);
    // Stop execution price = averagePrice * (1 - threshold) = 100 * 0.95 = 95
    expect(signals[0].metadata?.stopExecutionPrice).toBeCloseTo(95);
  });

  it('generateHardStopLossSignals does not fire when loss is below threshold', () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 5000,
      totalValue: 10000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
    };

    // BTC dropped from 100 → 96 (-4%), below 5% threshold
    const prices = new Map([['BTC', 96]]);

    const signals = (engine as any).generateHardStopLossSignals(portfolio, prices, 0.05);

    expect(signals).toHaveLength(0);
  });

  it('generateHardStopLossSignals does not fire for profitable positions', () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 5000,
      totalValue: 10000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1200 }]])
    };

    const prices = new Map([['BTC', 120]]);

    const signals = (engine as any).generateHardStopLossSignals(portfolio, prices, 0.05);

    expect(signals).toHaveLength(0);
  });

  it('generateHardStopLossSignals fires when low breaches stop but close recovers', () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 5000,
      totalValue: 10000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
    };

    // Close recovered to 97 (-3%, within threshold), but intra-candle low hit 85 (-15%)
    const closePrices = new Map([['BTC', 97]]);
    const lowPrices = new Map([['BTC', 85]]);

    const signals = (engine as any).generateHardStopLossSignals(portfolio, closePrices, 0.05, lowPrices);

    expect(signals).toHaveLength(1);
    expect(signals[0].coinId).toBe('BTC');
    // Stop execution price should be at the stop level, not the low or close
    expect(signals[0].metadata?.stopExecutionPrice).toBeCloseTo(95); // 100 * (1 - 0.05)
  });

  it('generateHardStopLossSignals does not fire when low stays above stop price', () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 5000,
      totalValue: 10000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
    };

    // Close at 97 (-3%), low at 96 (-4%) — both within 5% threshold
    const closePrices = new Map([['BTC', 97]]);
    const lowPrices = new Map([['BTC', 96]]);

    const signals = (engine as any).generateHardStopLossSignals(portfolio, closePrices, 0.05, lowPrices);

    expect(signals).toHaveLength(0);
  });

  it('executeTrade fills at stop execution price instead of close for hard stop-loss', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 0,
      totalValue: 1000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
    };

    // Close price is 80 (-20%), but the hard stop should fill at 95 (stop price)
    const stopLossSignal: TradingSignal = {
      action: 'SELL',
      coinId: 'BTC',
      quantity: 10,
      reason: 'Hard stop-loss triggered',
      confidence: 1,
      originalType: SignalType.STOP_LOSS,
      metadata: { hardStopLoss: true, stopExecutionPrice: 95, threshold: 0.05 }
    };

    const result = await (engine as any).executeTrade(
      stopLossSignal,
      portfolio,
      { timestamp: new Date(), prices: new Map([['BTC', 80]]) },
      0,
      { next: () => 0.5 },
      noSlippage,
      undefined,
      0
    );

    expect(result).toBeTruthy();
    // Should fill at $95 (stop price), NOT $80 (close price)
    expect(result.trade.price).toBeCloseTo(95);
    expect(result.trade.realizedPnL).toBeCloseTo(-50); // (95 - 100) * 10
    expect(result.trade.realizedPnLPercent).toBeCloseTo(-0.05);
  });

  it('hard stop-loss SELL bypasses minimum hold period', async () => {
    const engine = createEngine();
    const entryDate = new Date('2024-01-01T00:00:00.000Z');
    const portfolio: Portfolio = {
      cashBalance: 5000,
      totalValue: 10000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000, entryDate }]])
    };

    // Only 1 hour after entry — within 24h hold period
    const sellTimestamp = new Date('2024-01-01T01:00:00.000Z');

    // Hard stop-loss signal has originalType STOP_LOSS which bypasses hold period
    const stopLossSignal: TradingSignal = {
      action: 'SELL',
      coinId: 'BTC',
      quantity: 10,
      reason: 'Hard stop-loss triggered',
      confidence: 1,
      originalType: SignalType.STOP_LOSS,
      metadata: { hardStopLoss: true }
    };

    const result = await (engine as any).executeTrade(
      stopLossSignal,
      portfolio,
      { timestamp: sellTimestamp, prices: new Map([['BTC', 80]]) },
      0,
      { next: () => 0.5 },
      noSlippage,
      undefined,
      0 // minHoldMs = 0 (hard stop-loss passes 0)
    );

    expect(result).toBeTruthy();
    expect(result.trade.quantity).toBe(10);
    expect(result.trade.type).toBe('SELL');
  });

  it('records hardStopLoss metadata in trade', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 5000,
      totalValue: 10000,
      positions: new Map([['BTC', { coinId: 'BTC', quantity: 10, averagePrice: 100, totalValue: 1000 }]])
    };

    const stopLossSignal: TradingSignal = {
      action: 'SELL',
      coinId: 'BTC',
      quantity: 10,
      reason: 'Hard stop-loss triggered',
      confidence: 1,
      originalType: SignalType.STOP_LOSS,
      metadata: { hardStopLoss: true, unrealizedPnLPercent: -0.1, threshold: 0.05 }
    };

    const result = await (engine as any).executeTrade(
      stopLossSignal,
      portfolio,
      { timestamp: new Date(), prices: new Map([['BTC', 90]]) },
      0,
      { next: () => 0.5 },
      noSlippage,
      undefined,
      0
    );

    expect(result).toBeTruthy();
    expect(result.trade.metadata?.hardStopLoss).toBe(true);
    expect(result.trade.metadata?.unrealizedPnLPercent).toBe(-0.1);
  });
});

describe('BacktestEngine per-run allocation overrides', () => {
  const noSlippage = { type: SlippageModelType.NONE };

  const createEngine = () =>
    new BacktestEngine(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState,
      positionAnalysis,
      signalThrottle,
      regimeGateService,
      volatilityCalculator
    );

  it('respects custom maxAllocation and minAllocation passed to executeTrade', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 10000,
      totalValue: 10000,
      positions: new Map()
    };

    // With confidence=1.0 and custom max=0.30, should allocate 30%
    const highConfidenceSignal: TradingSignal = {
      action: 'BUY',
      coinId: 'BTC',
      confidence: 1.0,
      reason: 'entry'
    };

    const result = await (engine as any).executeTrade(
      highConfidenceSignal,
      portfolio,
      { timestamp: new Date(), prices: new Map([['BTC', 100]]) },
      0,
      { next: () => 0.5 },
      noSlippage,
      undefined,
      0, // minHoldMs
      0.3, // maxAllocation override
      0.05 // minAllocation override
    );

    // confidence=1.0 → allocation = minAlloc + 1.0 * (maxAlloc - minAlloc) = 0.05 + 0.25 = 0.30
    expect(result?.trade.totalValue).toBeCloseTo(3000); // 30% of $10,000
  });

  it('uses custom minAllocation for zero-confidence signals', async () => {
    const engine = createEngine();
    const portfolio: Portfolio = {
      cashBalance: 10000,
      totalValue: 10000,
      positions: new Map()
    };

    const lowConfidenceSignal: TradingSignal = {
      action: 'BUY',
      coinId: 'BTC',
      confidence: 0.0,
      reason: 'weak entry'
    };

    const result = await (engine as any).executeTrade(
      lowConfidenceSignal,
      portfolio,
      { timestamp: new Date(), prices: new Map([['BTC', 100]]) },
      0,
      { next: () => 0.5 },
      noSlippage,
      undefined,
      0,
      0.2, // maxAllocation
      0.08 // minAllocation override
    );

    // confidence=0.0 → allocation = minAlloc = 0.08
    expect(result?.trade.totalValue).toBeCloseTo(800); // 8% of $10,000
  });
});
