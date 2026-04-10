import { CompositeRegimeType, MarketRegimeType, SignalReasonCode } from '@chansey/api-interfaces';

import { PaperTradingEngineService } from './paper-trading-engine.service';

import { SignalType } from '../../algorithm/interfaces';
import { PAPER_TRADING_DEFAULT_THROTTLE_CONFIG } from '../backtest/shared';

/**
 * Engine-level orchestration tests only.
 *
 * Execution, sizing, hold periods, slippage, entry/exit dates, session metrics math,
 * opportunity-sell scoring, throttle state, snapshot persistence, and signal mapping
 * each have their own focused unit spec under `engine/*.spec.ts`. These tests assert
 * how `PaperTradingEngineService.processTick` wires those collaborators together —
 * the held-coin guard, exit → algo refresh, signal-loop counting, retry on
 * insufficient funds, regime gate persistence, the try/catch wrapper, and
 * per-signal `finally { markProcessed }`.
 */

type MockAccount = { currency: string; available: number; total: number; averageCost?: number };

interface Overrides {
  accounts?: MockAccount[];
  prices?: Record<string, number>;
  quoteCurrency?: string;
  compositeRegime?: CompositeRegimeType;
  signalFilterChainApply?: jest.Mock;
  exitOrdersExecuted?: number;
  signalThrottle?: Record<string, jest.Mock>;
  resolveSymbolUniverse?: jest.Mock;
}

const createService = (overrides: Overrides = {}) => {
  const accounts = overrides.accounts ?? [{ currency: 'USD', available: 10000, total: 10000 }];
  const prices = overrides.prices ?? { 'BTC/USD': 50000 };
  const quoteCurrency = overrides.quoteCurrency ?? 'USD';

  const buildPortfolio = (accs: MockAccount[]) => {
    const cash = accs.find((a) => a.currency === quoteCurrency);
    const positions = new Map<string, any>();
    let posValue = 0;
    for (const a of accs) {
      if (a.currency !== quoteCurrency && a.total > 0) {
        const price = prices[`${a.currency}/${quoteCurrency}`] ?? 0;
        const totalValue = a.total * price;
        posValue += totalValue;
        positions.set(a.currency, {
          coinId: a.currency,
          quantity: a.total,
          averagePrice: a.averageCost ?? 0,
          totalValue
        });
      }
    }
    return {
      cashBalance: cash?.available ?? 0,
      positions,
      totalValue: (cash?.available ?? 0) + posValue
    };
  };

  const portfolioService = {
    loadAccounts: jest.fn().mockResolvedValue(accounts),
    getQuoteCurrency: jest.fn().mockReturnValue(quoteCurrency),
    buildFromAccounts: jest.fn((a: MockAccount[]) => buildPortfolio(a)),
    updateWithPrices: jest.fn((p: any) => p),
    buildPositionsContext: jest.fn(() => ({})),
    refresh: jest.fn().mockImplementation(() => ({
      accounts,
      portfolio: buildPortfolio(accounts)
    }))
  };

  const signalService = {
    save: jest.fn().mockImplementation(() => ({ status: null, rejectionCode: null })),
    markRejected: jest.fn().mockResolvedValue(undefined),
    markProcessed: jest.fn().mockResolvedValue(undefined)
  };

  const snapshotService = {
    save: jest.fn().mockResolvedValue(undefined),
    calculateSessionMetrics: jest.fn()
  };

  const throttleService = {
    filter: jest.fn().mockImplementation((_id: string, signals: any[]) => ({ accepted: signals, rejected: [] })),
    clear: jest.fn(),
    has: jest.fn(),
    restore: jest.fn(),
    getSerialized: jest.fn(),
    sweepOrphaned: jest.fn().mockReturnValue(0)
  };

  const orderExecutor = {
    execute: jest.fn().mockResolvedValue({
      status: 'success',
      order: { id: 'o-1', executedPrice: 50000, filledQuantity: 0.1 }
    })
  };

  const exitExecutor = {
    getOrCreate: jest.fn(),
    checkAndExecute: jest.fn().mockResolvedValue(overrides.exitOrdersExecuted ?? 0),
    onBuyFill: jest.fn(),
    onSellFill: jest.fn(),
    serialize: jest.fn(),
    clear: jest.fn(),
    sweep: jest.fn().mockReturnValue(0)
  };

  const opportunitySelling = {
    attempt: jest.fn().mockResolvedValue(0)
  };

  const marketDataService = {
    getPrices: jest.fn().mockResolvedValue(new Map(Object.entries(prices).map(([sym, p]) => [sym, { price: p }]))),
    getHistoricalCandles: jest.fn().mockResolvedValue([]),
    resolveSymbolUniverse:
      overrides.resolveSymbolUniverse ??
      jest
        .fn()
        .mockResolvedValue(
          Object.keys(prices).length > 0 ? Object.keys(prices) : [`BTC/${quoteCurrency}`, `ETH/${quoteCurrency}`]
        ),
    clearSymbolCache: jest.fn(),
    sweepOrphaned: jest.fn().mockReturnValue(0)
  };

  const algorithmRegistry = {
    executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
  };

  const compositeRegimeService = {
    getCompositeRegime: jest.fn().mockReturnValue(overrides.compositeRegime ?? CompositeRegimeType.BULL),
    getVolatilityRegime: jest.fn().mockReturnValue(MarketRegimeType.NORMAL)
  };

  const signalFilterChain = {
    apply:
      overrides.signalFilterChainApply ??
      jest.fn().mockImplementation((signals: any[], _ctx: any, alloc: any) => ({
        signals,
        maxAllocation: alloc.maxAllocation,
        minAllocation: alloc.minAllocation,
        regimeGateBlockedCount: 0,
        regimeMultiplier: 1
      }))
  };

  const signalThrottle = overrides.signalThrottle ?? { resolveConfig: jest.fn().mockReturnValue({}) };

  const service = new PaperTradingEngineService(
    marketDataService as any,
    algorithmRegistry as any,
    signalThrottle as any,
    compositeRegimeService as any,
    signalFilterChain as any,
    portfolioService as any,
    signalService as any,
    snapshotService as any,
    throttleService as any,
    orderExecutor as any,
    exitExecutor as any,
    opportunitySelling as any
  );

  return {
    service,
    portfolioService,
    signalService,
    snapshotService,
    throttleService,
    orderExecutor,
    exitExecutor,
    opportunitySelling,
    marketDataService,
    algorithmRegistry,
    signalFilterChain,
    compositeRegimeService
  };
};

const makeSession = (overrides: Record<string, any> = {}): any => ({
  id: 'session-1',
  initialCapital: 10000,
  tickCount: 10,
  user: { id: 'user-1' },
  algorithm: { id: 'algo-1' },
  ...overrides
});

const exchangeKey: any = { exchange: { slug: 'binance' } };

describe('PaperTradingEngineService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a failed tick result when processing throws', async () => {
    const { service, portfolioService } = createService();
    portfolioService.loadAccounts.mockRejectedValueOnce(new Error('db down'));

    const session = makeSession({ currentPortfolioValue: 1100 });
    const result = await service.processTick(session, exchangeKey);

    expect(result.processed).toBe(false);
    expect(result.errors).toEqual(['db down']);
    expect(result.portfolioValue).toBe(1100);
    expect(result.prices).toEqual({});
  });

  it('delegates calculateSessionMetrics to snapshotService', async () => {
    const { service, snapshotService } = createService();
    const metrics = {
      sharpeRatio: 1.23,
      winRate: 0.5,
      totalTrades: 3,
      winningTrades: 1,
      losingTrades: 1,
      maxDrawdown: 0.25
    };
    snapshotService.calculateSessionMetrics.mockResolvedValue(metrics);

    const session = makeSession();
    await expect(service.calculateSessionMetrics(session)).resolves.toEqual(metrics);
    expect(snapshotService.calculateSessionMetrics).toHaveBeenCalledWith(session);
  });

  it('defaults to BTC/ETH symbols when no holdings or config and takes a snapshot on interval ticks', async () => {
    const resolveSymbolUniverse = jest.fn().mockResolvedValue(['BTC/USD', 'ETH/USD']);
    const prices = { 'BTC/USD': 50000, 'ETH/USD': 3000 };
    const { service, marketDataService, snapshotService } = createService({
      accounts: [],
      prices,
      resolveSymbolUniverse
    });

    const result = await service.processTick(makeSession({ tickCount: 10 }), exchangeKey);

    expect(resolveSymbolUniverse).toHaveBeenCalledTimes(1);
    expect(marketDataService.getPrices).toHaveBeenCalledWith('binance', ['BTC/USD', 'ETH/USD']);
    expect(snapshotService.save).toHaveBeenCalledTimes(1);
    expect(result.processed).toBe(true);
  });

  it('uses resolved symbols from marketDataService when no holdings', async () => {
    const resolveSymbolUniverse = jest.fn().mockResolvedValue(['BNB/USD', 'BTC/USD', 'ETH/USD']);
    const prices = { 'BNB/USD': 300, 'BTC/USD': 50000, 'ETH/USD': 3000 };
    const { service, marketDataService } = createService({ accounts: [], prices, resolveSymbolUniverse });

    await service.processTick(makeSession(), exchangeKey);

    expect(resolveSymbolUniverse).toHaveBeenCalledTimes(1);
    expect(marketDataService.getPrices).toHaveBeenCalledWith(
      'binance',
      expect.arrayContaining(['BNB/USD', 'BTC/USD', 'ETH/USD'])
    );
  });

  describe('validSymbols exchange filtering', () => {
    it('only fetches candles for symbols present in the price map', async () => {
      // Exchange returns prices only for BTC/USD; UNKNOWN/USD is absent from the price response
      const resolveSymbolUniverse = jest.fn().mockResolvedValue(['BTC/USD', 'UNKNOWN/USD']);
      const prices = { 'BTC/USD': 50000 }; // UNKNOWN/USD intentionally absent
      const { service, marketDataService } = createService({ accounts: [], prices, resolveSymbolUniverse });

      await service.processTick(makeSession(), exchangeKey);

      const candleCalls = marketDataService.getHistoricalCandles.mock.calls.map((c: any[]) => c[1]);
      expect(candleCalls).toContain('BTC/USD');
      expect(candleCalls).not.toContain('UNKNOWN/USD');
    });
  });

  it('refreshes portfolio before running the algorithm when exits executed', async () => {
    const { service, portfolioService, algorithmRegistry } = createService({ exitOrdersExecuted: 2 });

    const result = await service.processTick(makeSession(), exchangeKey);

    expect(result.ordersExecuted).toBe(2);
    expect(portfolioService.refresh).toHaveBeenCalled();
    // The refresh call triggered by exits must happen before the algorithm runs
    const firstRefreshOrder = portfolioService.refresh.mock.invocationCallOrder[0];
    const algoOrder = algorithmRegistry.executeAlgorithm.mock.invocationCallOrder[0];
    expect(firstRefreshOrder).toBeLessThan(algoOrder);
  });

  it('passes post-exit refreshed portfolio (not the pre-exit snapshot) into the signal loop', async () => {
    // Starting accounts represent pre-exit state; refresh returns post-exit state with more cash.
    const preExitAccounts = [
      { currency: 'USD', available: 1000, total: 1000 },
      { currency: 'BTC', available: 1, total: 1, averageCost: 40000 }
    ];
    const postExitAccounts = [{ currency: 'USD', available: 51000, total: 51000 }];
    const { service, portfolioService, orderExecutor, algorithmRegistry } = createService({
      accounts: preExitAccounts,
      prices: { 'BTC/USD': 50000, 'ETH/USD': 3000 },
      exitOrdersExecuted: 1
    });

    // After the exit fires, refresh returns a fresh, bigger portfolio.
    portfolioService.refresh.mockResolvedValue({
      accounts: postExitAccounts,
      portfolio: { cashBalance: 51000, positions: new Map(), totalValue: 51000 }
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [{ type: SignalType.BUY, coinId: 'ETH', strength: 0.1, confidence: 0.5, reason: 'entry' }]
    });

    await service.processTick(makeSession(), exchangeKey);

    expect(orderExecutor.execute).toHaveBeenCalled();
    const firstCallCtx = orderExecutor.execute.mock.calls[0][0];
    expect(firstCallCtx.portfolio.totalValue).toBe(51000);
  });

  it('skips BUY signal when the position is already held', async () => {
    const { service, orderExecutor, signalService, algorithmRegistry } = createService({
      accounts: [
        { currency: 'USD', available: 10000, total: 10000 },
        { currency: 'ETH', available: 1.5, total: 1.5 }
      ],
      prices: { 'ETH/USD': 3000 }
    });
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        { type: SignalType.BUY, coinId: 'ETH', strength: 0.1, quantity: 0.5, confidence: 0.9, reason: 'add to' }
      ]
    });

    const result = await service.processTick(makeSession(), exchangeKey);

    expect(orderExecutor.execute).not.toHaveBeenCalled();
    expect(signalService.save).not.toHaveBeenCalled();
    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });

  it('handles algorithm execution failure gracefully', async () => {
    const { service, algorithmRegistry } = createService();
    algorithmRegistry.executeAlgorithm.mockRejectedValue(new Error('algo blew up'));

    const result = await service.processTick(makeSession(), exchangeKey);

    expect(result.processed).toBe(true);
    expect(result.signalsReceived).toBe(0);
    expect(result.ordersExecuted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('marks the signal processed even when orderExecutor throws (finally block)', async () => {
    const { service, orderExecutor, signalService, algorithmRegistry } = createService();
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [{ type: SignalType.BUY, coinId: 'BTC', strength: 0.1, quantity: 0.1, confidence: 0.8, reason: 'entry' }]
    });
    orderExecutor.execute.mockRejectedValueOnce(new Error('deadlock'));

    const result = await service.processTick(makeSession(), exchangeKey);

    expect(result.processed).toBe(true);
    expect(result.ordersExecuted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('deadlock');
    expect(signalService.markProcessed).toHaveBeenCalledTimes(1);
  });

  it('processes multiple signals in a single tick and counts all executed orders', async () => {
    const { service, orderExecutor, algorithmRegistry } = createService({
      accounts: [
        { currency: 'USD', available: 50000, total: 50000 },
        { currency: 'BTC', available: 2, total: 2, averageCost: 40000 }
      ],
      prices: { 'BTC/USD': 50000, 'ETH/USD': 3000 }
    });
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        { type: SignalType.SELL, coinId: 'BTC', strength: 0.5, quantity: 0.5, confidence: 0.9, reason: 'partial' },
        { type: SignalType.BUY, coinId: 'ETH', strength: 0.1, quantity: 1, confidence: 0.7, reason: 'entry' }
      ]
    });

    const result = await service.processTick(makeSession(), exchangeKey);

    expect(result.signalsReceived).toBe(2);
    expect(result.ordersExecuted).toBe(2);
    expect(orderExecutor.execute).toHaveBeenCalledTimes(2);
  });

  it('refreshes portfolio between successful orders so the second signal sees fresh cash', async () => {
    const { service, portfolioService, algorithmRegistry } = createService({
      prices: { 'BTC/USD': 50000, 'ETH/USD': 3000 }
    });
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        { type: SignalType.BUY, coinId: 'BTC', strength: 0.08, confidence: 0.8, reason: 'entry BTC' },
        { type: SignalType.BUY, coinId: 'ETH', strength: 0.08, confidence: 0.8, reason: 'entry ETH' }
      ]
    });

    const result = await service.processTick(makeSession(), exchangeKey);

    expect(result.ordersExecuted).toBe(2);
    // 1 refresh after each of the 2 successful orders + 1 refresh in finalizeSnapshot
    expect(portfolioService.refresh).toHaveBeenCalledTimes(3);
  });

  describe('opportunity selling orchestration', () => {
    it('invokes opportunitySelling.attempt and retries BUY when sells free cash', async () => {
      const { service, orderExecutor, opportunitySelling, algorithmRegistry } = createService();
      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.05, quantity: 0.1, confidence: 0.85, reason: 'entry' }
        ]
      });
      // First attempt returns insufficient_funds, retry succeeds
      orderExecutor.execute
        .mockResolvedValueOnce({ status: 'insufficient_funds', order: null })
        .mockResolvedValueOnce({ status: 'success', order: { id: 'o-2' } });
      opportunitySelling.attempt.mockResolvedValue(1);

      const session = makeSession({ algorithmConfig: { enableOpportunitySelling: true } });
      const result = await service.processTick(session, exchangeKey);

      expect(opportunitySelling.attempt).toHaveBeenCalledTimes(1);
      expect(orderExecutor.execute).toHaveBeenCalledTimes(2);
      // 1 opp-sell + 1 retried BUY
      expect(result.ordersExecuted).toBe(2);
    });

    it('does not invoke opportunitySelling.attempt when BUY fails for a non-funds reason', async () => {
      const { service, orderExecutor, opportunitySelling, algorithmRegistry } = createService();
      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.05, quantity: 0.1, confidence: 0.85, reason: 'entry' }
        ]
      });
      orderExecutor.execute.mockResolvedValueOnce({ status: 'no_price', order: null });

      const session = makeSession({ algorithmConfig: { enableOpportunitySelling: true } });
      const result = await service.processTick(session, exchangeKey);

      expect(opportunitySelling.attempt).not.toHaveBeenCalled();
      expect(result.ordersExecuted).toBe(0);
    });
  });

  describe('regime gate filtering', () => {
    it('persists REGIME_GATE rejection for BUY signals blocked in BEAR regime', async () => {
      const signalFilterChainApply = jest.fn().mockImplementation((signals: any[], _ctx: any, alloc: any) => ({
        signals: signals.filter((s) => s.action !== 'BUY'),
        maxAllocation: alloc.maxAllocation,
        minAllocation: alloc.minAllocation,
        regimeGateBlockedCount: signals.filter((s) => s.action === 'BUY').length,
        regimeMultiplier: 0.1
      }));

      const { service, orderExecutor, signalService, algorithmRegistry } = createService({
        compositeRegime: CompositeRegimeType.BEAR,
        signalFilterChainApply
      });
      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.1, quantity: 0.01, confidence: 0.8, reason: 'entry' }
        ]
      });

      const result = await service.processTick(makeSession({ riskLevel: 3 }), exchangeKey);

      expect(orderExecutor.execute).not.toHaveBeenCalled();
      expect(signalService.markRejected).toHaveBeenCalledWith(expect.anything(), SignalReasonCode.REGIME_GATE);
      expect(result.ordersExecuted).toBe(0);
    });

    it('allows STOP_LOSS to pass through the regime gate in BEAR regime', async () => {
      const { service, orderExecutor, algorithmRegistry } = createService({
        accounts: [
          { currency: 'USD', available: 5000, total: 5000 },
          { currency: 'BTC', available: 1, total: 1, averageCost: 40000 }
        ],
        compositeRegime: CompositeRegimeType.BEAR
      });
      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.STOP_LOSS, coinId: 'BTC', strength: 1.0, quantity: 0.5, confidence: 1.0, reason: 'sl' }
        ]
      });

      const result = await service.processTick(makeSession({ riskLevel: 3 }), exchangeKey);

      expect(orderExecutor.execute).toHaveBeenCalledTimes(1);
      expect(result.ordersExecuted).toBe(1);
    });
  });

  it('passes PAPER_TRADING_DEFAULT_THROTTLE_CONFIG as defaults to resolveConfig', async () => {
    const signalThrottle = {
      createState: jest.fn().mockReturnValue({ lastSignalTime: {}, tradeTimestamps: [] }),
      filterSignals: jest.fn().mockImplementation((signals: any[]) => ({ accepted: signals, rejected: [] })),
      resolveConfig: jest.fn().mockReturnValue({ cooldownMs: 0, maxTradesPerDay: 6, minSellPercent: 0.5 }),
      toThrottleSignal: jest.fn().mockImplementation((s: any) => s)
    };
    const { service, marketDataService, algorithmRegistry } = createService({ signalThrottle });

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    algorithmRegistry.executeAlgorithm.mockResolvedValue({ success: true, signals: [] });

    const session = {
      id: 'session-throttle-check',
      initialCapital: 10000,
      tickCount: 1,
      user: { id: 'user-1' }
    } as any;
    await service.processTick(session, { exchange: { slug: 'binance' } } as any);

    expect(signalThrottle.resolveConfig).toHaveBeenCalledWith(
      session.algorithmConfig,
      PAPER_TRADING_DEFAULT_THROTTLE_CONFIG
    );
  });

  it('does not produce duplicate signals when multiple symbols share a base currency', async () => {
    const prices = { 'ETH/USDT': 1900, 'ETH/BTC': 0.05 };
    const accounts = [{ currency: 'USDT', available: 10000, total: 10000 }];
    const { service, marketDataService, algorithmRegistry } = createService({
      accounts,
      prices,
      quoteCurrency: 'USDT'
    });

    // Override getPrices to return both ETH symbols
    marketDataService.getPrices.mockResolvedValue(
      new Map([
        ['ETH/USDT', { price: 1900 }],
        ['ETH/BTC', { price: 0.05 }]
      ])
    );

    algorithmRegistry.executeAlgorithm.mockResolvedValue({ success: true, signals: [] });

    const session = { id: 'session-dedup', initialCapital: 10000, tickCount: 5, user: { id: 'user-1' } } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    await service.processTick(session, exchangeKey);

    // Algorithm should receive only one coin entry for ETH, not two
    const algorithmCall = algorithmRegistry.executeAlgorithm.mock.calls[0];
    const context = algorithmCall[1]; // second argument is the AlgorithmContext
    const ethCoins = context.coins.filter((c: any) => c.id === 'ETH');

    expect(ethCoins).toHaveLength(1);
  });
});
