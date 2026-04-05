import { CompositeRegimeType, MarketRegimeType } from '@chansey/api-interfaces';

import { PaperTradingOrderSide } from './entities';
import { PaperTradingEngineService } from './paper-trading-engine.service';

import { SignalType } from '../../algorithm/interfaces';

const createService = (overrides: Partial<any> = {}) => {
  const accountRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn()
  };
  const orderRepository = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    createQueryBuilder: jest.fn()
  };
  const signalRepository = {
    save: jest.fn(),
    create: jest.fn()
  };
  const snapshotRepository = {
    find: jest.fn(),
    save: jest.fn(),
    create: jest.fn()
  };

  const dataSource = {};

  const marketDataService = {
    getPrices: jest.fn(),
    getHistoricalCandles: jest.fn().mockResolvedValue([]),
    calculateRealisticSlippage: jest.fn()
  };

  const algorithmRegistry = {
    executeAlgorithm: jest.fn()
  };

  const feeCalculator = {
    fromFlatRate: jest.fn(),
    calculateFee: jest.fn()
  };
  const positionManager = {};
  const metricsCalculator = {
    calculateSharpeRatio: jest.fn()
  };
  const portfolioState = {};
  const signalThrottle = {
    createState: jest.fn().mockReturnValue({ lastSignalTime: {}, tradeTimestamps: [] }),
    filterSignals: jest.fn().mockImplementation((signals: any[]) => ({ accepted: signals, rejected: [] })),
    resolveConfig: jest.fn().mockReturnValue({ cooldownMs: 86_400_000, maxTradesPerDay: 6, minSellPercent: 0.5 })
  };

  const compositeRegimeService = {
    getCompositeRegime: jest.fn().mockReturnValue(CompositeRegimeType.BULL),
    getVolatilityRegime: jest.fn().mockReturnValue(MarketRegimeType.NORMAL)
  };

  const signalFilterChain = {
    apply: jest.fn().mockImplementation((signals: any[], _ctx: any, allocation: any) => ({
      signals,
      maxAllocation: allocation.maxAllocation,
      minAllocation: allocation.minAllocation,
      regimeGateBlockedCount: 0,
      regimeMultiplier: 1
    }))
  };

  const positionAnalysis = {
    calculatePositionSellScore: jest.fn().mockReturnValue({
      eligible: true,
      totalScore: 10,
      unrealizedPnLScore: 5,
      protectedGainsScore: 0,
      holdingPeriodScore: 5,
      opportunityAdvantageScore: 0,
      algorithmRankingScore: 0,
      unrealizedPnLPercent: -5,
      holdingPeriodHours: 72
    })
  };

  return {
    service: new PaperTradingEngineService(
      overrides.accountRepository ?? (accountRepository as any),
      overrides.orderRepository ?? (orderRepository as any),
      overrides.signalRepository ?? (signalRepository as any),
      overrides.snapshotRepository ?? (snapshotRepository as any),
      overrides.dataSource ?? (dataSource as any),
      overrides.marketDataService ?? (marketDataService as any),
      overrides.algorithmRegistry ?? (algorithmRegistry as any),
      overrides.feeCalculator ?? (feeCalculator as any),
      overrides.positionManager ?? (positionManager as any),
      overrides.metricsCalculator ?? (metricsCalculator as any),
      overrides.portfolioState ?? (portfolioState as any),
      overrides.signalThrottle ?? (signalThrottle as any),
      overrides.compositeRegimeService ?? (compositeRegimeService as any),
      overrides.signalFilterChain ?? (signalFilterChain as any),
      overrides.positionAnalysis ?? (positionAnalysis as any)
    ),
    accountRepository,
    orderRepository,
    signalRepository,
    snapshotRepository,
    metricsCalculator,
    marketDataService,
    algorithmRegistry,
    feeCalculator,
    compositeRegimeService,
    signalFilterChain,
    positionAnalysis
  };
};

describe('PaperTradingEngineService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns a failed tick result when processing throws', async () => {
    const { service, accountRepository } = createService();
    accountRepository.find.mockRejectedValue(new Error('db down'));

    const session = {
      id: 'session-1',
      initialCapital: 1000,
      currentPortfolioValue: 1100
    } as any;

    const result = await service.processTick(session, {} as any);

    expect(result.processed).toBe(false);
    expect(result.errors).toEqual(['db down']);
    expect(result.portfolioValue).toBe(1100);
  });

  it('calculates session metrics from orders and snapshots', async () => {
    const { service, orderRepository, snapshotRepository, metricsCalculator } = createService();

    orderRepository.find.mockResolvedValue([
      { side: PaperTradingOrderSide.BUY, realizedPnL: null },
      { side: PaperTradingOrderSide.SELL, realizedPnL: 10 },
      { side: PaperTradingOrderSide.SELL, realizedPnL: -5 }
    ]);

    snapshotRepository.find.mockResolvedValue([
      { portfolioValue: 100, timestamp: new Date('2024-01-01T00:00:00Z') },
      { portfolioValue: 120, timestamp: new Date('2024-01-01T00:01:00Z') },
      { portfolioValue: 90, timestamp: new Date('2024-01-01T00:02:00Z') },
      { portfolioValue: 95, timestamp: new Date('2024-01-01T00:03:00Z') }
    ]);

    metricsCalculator.calculateSharpeRatio.mockReturnValue(1.23);

    const session = { id: 'session-1', initialCapital: 100 } as any;

    const result = await service.calculateSessionMetrics(session);

    expect(result).toEqual({
      sharpeRatio: 1.23,
      winRate: 0.5,
      totalTrades: 3,
      winningTrades: 1,
      losingTrades: 1,
      maxDrawdown: 0.25
    });
  });

  it('defaults to common symbols and snapshots on interval ticks', async () => {
    const { service, accountRepository, snapshotRepository, orderRepository, marketDataService, algorithmRegistry } =
      createService();

    accountRepository.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'USD', available: 1000, total: 1000 }]);

    const prices = new Map<string, { price: number }>([
      ['BTC/USD', { price: 50000 }],
      ['ETH/USD', { price: 3000 }]
    ]);

    marketDataService.getPrices.mockResolvedValue(prices);
    algorithmRegistry.executeAlgorithm.mockResolvedValue({ success: true, signals: [] });

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = { id: 'session-2', initialCapital: 1000, tickCount: 10, user: { id: 'user-1' } } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(marketDataService.getPrices).toHaveBeenCalledWith('binance', ['BTC/USD', 'ETH/USD']);
    expect(snapshotRepository.save).toHaveBeenCalled();
    expect(result.processed).toBe(true);
  });

  it('skips buy when balance is insufficient', async () => {
    const {
      service,
      accountRepository,
      signalRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService();

    const quoteAccount = { currency: 'USD', available: 50, total: 50 };

    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);
    accountRepository.findOne.mockResolvedValueOnce(quoteAccount).mockResolvedValueOnce(null);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 100 }]]));
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 100,
      slippageBps: 0,
      marketImpact: 0
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.BUY,
          coinId: 'BTC',
          strength: 0.5,
          quantity: 1,
          confidence: 0.5,
          reason: 'test'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 1 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-3',
      initialCapital: 1000,
      tickCount: 1,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(orderRepository.save).not.toHaveBeenCalled();
    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });

  it('skips BUY signal when position already held', async () => {
    const { service, accountRepository, signalRepository, orderRepository, marketDataService, algorithmRegistry } =
      createService();

    // User already holds ETH
    const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };
    const ethAccount = { currency: 'ETH', available: 1.5, total: 1.5 };

    accountRepository.find.mockResolvedValue([quoteAccount, ethAccount]);

    marketDataService.getPrices.mockResolvedValue(new Map([['ETH/USD', { price: 3000 }]]));

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.BUY,
          coinId: 'ETH',
          strength: 0.8,
          quantity: 0.5,
          confidence: 0.9,
          reason: 'bullish indicators'
        }
      ]
    });

    const session = {
      id: 'session-dup',
      initialCapital: 10000,
      tickCount: 1,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    // Signal should NOT be saved (skipped before saveSignal)
    expect(signalRepository.save).not.toHaveBeenCalled();
    // No order should be executed
    expect(orderRepository.save).not.toHaveBeenCalled();
    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });

  it('applies slippage to execution price for buy orders', async () => {
    const dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          findOne: jest
            .fn()
            .mockResolvedValueOnce({ currency: 'USD', available: 10000, total: 10000 })
            .mockResolvedValueOnce(null),
          create: jest.fn((entity: any, data: any) => data),
          save: jest.fn((entity: any) => Promise.resolve(entity))
        })
      )
    };

    const {
      service,
      accountRepository,
      signalRepository,
      snapshotRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
    accountRepository.find
      .mockResolvedValueOnce([quoteAccount])
      .mockResolvedValueOnce([quoteAccount]) // refresh after successful order
      .mockResolvedValueOnce([quoteAccount, { currency: 'BTC', available: 0.1, total: 0.1 }]);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    // Slippage of 10 bps means price increases by 0.1% for BUY
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 50050, // 50000 * (1 + 10/10000)
      slippageBps: 10,
      marketImpact: 5
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.BUY,
          coinId: 'BTC',
          strength: 0.1,
          quantity: 0.1,
          confidence: 0.8,
          reason: 'test slippage'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-slippage',
      initialCapital: 10000,
      tickCount: 10,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(marketDataService.calculateRealisticSlippage).toHaveBeenCalledWith(
      'binance',
      'BTC/USD',
      expect.any(Number),
      'BUY'
    );
    expect(result.processed).toBe(true);
    expect(result.ordersExecuted).toBe(1);
  });

  it('executes sell order and calculates realized PnL', async () => {
    const btcAccount = { currency: 'BTC', available: 1, total: 1, averageCost: 40000 };
    const quoteAccount = { currency: 'USD', available: 1000, total: 1000 };

    const dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          findOne: jest.fn().mockResolvedValueOnce(quoteAccount).mockResolvedValueOnce(btcAccount),
          create: jest.fn((entity: any, data: any) => data),
          save: jest.fn((entity: any) => Promise.resolve(entity))
        })
      )
    };

    const {
      service,
      accountRepository,
      signalRepository,
      snapshotRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    accountRepository.find
      .mockResolvedValueOnce([quoteAccount, btcAccount])
      .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after successful order
      .mockResolvedValueOnce([quoteAccount, btcAccount]);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    // Slippage for SELL - price decreases
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 49950, // 50000 * (1 - 10/10000)
      slippageBps: 10,
      marketImpact: 5
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.SELL,
          coinId: 'BTC',
          strength: 0.5,
          quantity: 0.5,
          confidence: 0.9,
          reason: 'take profit'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 25 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-sell',
      initialCapital: 50000,
      tickCount: 10,
      tradingFee: 0.001,
      peakPortfolioValue: 51000,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(marketDataService.calculateRealisticSlippage).toHaveBeenCalledWith(
      'binance',
      'BTC/USD',
      expect.any(Number),
      'SELL'
    );
    expect(result.processed).toBe(true);
    expect(result.ordersExecuted).toBe(1);
  });

  it('skips sell when no position to sell', async () => {
    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };

    const dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          findOne: jest.fn().mockResolvedValueOnce(quoteAccount).mockResolvedValueOnce(null), // No BTC account
          create: jest.fn((entity: any, data: any) => data),
          save: jest.fn((entity: any) => Promise.resolve(entity))
        })
      )
    };

    const {
      service,
      accountRepository,
      signalRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 49950,
      slippageBps: 10,
      marketImpact: 5
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.SELL,
          coinId: 'BTC',
          strength: 1.0,
          quantity: 1,
          confidence: 0.95,
          reason: 'no position'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 50 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    const session = {
      id: 'session-no-pos',
      initialCapital: 10000,
      tickCount: 1,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });

  it('handles algorithm execution failure gracefully', async () => {
    const { service, accountRepository, snapshotRepository, orderRepository, marketDataService, algorithmRegistry } =
      createService();

    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));

    algorithmRegistry.executeAlgorithm.mockRejectedValue(new Error('Algorithm failed'));

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = { id: 'session-algo-fail', initialCapital: 10000, tickCount: 10, user: { id: 'user-1' } } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.signalsReceived).toBe(0);
    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });

  it('caps sell quantity at available position size', async () => {
    const btcAccount = { currency: 'BTC', available: 1, total: 1, averageCost: 40000 };
    const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

    const savedEntities: any[] = [];
    const dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          findOne: jest
            .fn()
            .mockResolvedValueOnce(quoteAccount)
            .mockResolvedValueOnce({ ...btcAccount }),
          create: jest.fn((_entity: any, data: any) => data),
          save: jest.fn((entity: any) => {
            savedEntities.push(entity);
            return Promise.resolve(entity);
          })
        })
      )
    };

    const {
      service,
      accountRepository,
      signalRepository,
      snapshotRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    accountRepository.find
      .mockResolvedValueOnce([quoteAccount, btcAccount])
      .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after successful order
      .mockResolvedValueOnce([quoteAccount, btcAccount]);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 50000,
      slippageBps: 0,
      marketImpact: 0
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.SELL,
          coinId: 'BTC',
          strength: 1.0,
          quantity: 10, // Requests 10 BTC but only 1 available
          confidence: 0.9,
          reason: 'sell all'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 50 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-cap',
      initialCapital: 50000,
      tickCount: 10,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.ordersExecuted).toBe(1);
    // The order entity should have quantity capped to 1 (available), not 10 (requested)
    const orderEntity = savedEntities.find((e) => e.side === 'SELL');
    expect(orderEntity).toBeDefined();
    expect(orderEntity.filledQuantity).toBe(1);
    expect(orderEntity.requestedQuantity).toBe(1);
  });

  it('captures order execution error but still completes tick successfully', async () => {
    const dataSource = {
      transaction: jest.fn().mockRejectedValue(new Error('Transaction deadlock'))
    };

    const {
      service,
      accountRepository,
      signalRepository,
      snapshotRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 50000,
      slippageBps: 0,
      marketImpact: 0
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.BUY,
          coinId: 'BTC',
          strength: 0.1,
          quantity: 0.1,
          confidence: 0.8,
          reason: 'buy signal'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-err',
      initialCapital: 10000,
      tickCount: 10,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.processed).toBe(true);
    expect(result.ordersExecuted).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Transaction deadlock');
  });

  it('calculates BUY quantity from percentage-based allocation', async () => {
    const savedEntities: any[] = [];
    const dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          findOne: jest
            .fn()
            .mockResolvedValueOnce({ currency: 'USD', available: 10000, total: 10000 })
            .mockResolvedValueOnce(null),
          create: jest.fn((_entity: any, data: any) => data),
          save: jest.fn((entity: any) => {
            savedEntities.push(entity);
            return Promise.resolve(entity);
          })
        })
      )
    };

    const {
      service,
      accountRepository,
      signalRepository,
      snapshotRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
    accountRepository.find
      .mockResolvedValueOnce([quoteAccount])
      .mockResolvedValueOnce([quoteAccount]) // refresh after successful order
      .mockResolvedValueOnce([quoteAccount]);

    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 50000,
      slippageBps: 0,
      marketImpact: 0
    });

    // Signal has strength (mapped to percentage) of 0.1 but no quantity
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.BUY,
          coinId: 'BTC',
          strength: 0.1, // maps to signal.percentage
          // no quantity field
          confidence: 0.8,
          reason: 'percentage buy'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 1 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-pct',
      initialCapital: 10000,
      tickCount: 10,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.ordersExecuted).toBe(1);
    // portfolio.totalValue = 10000, percentage = 0.1, min(0.1, PAPER_TRADE risk-3 maxAlloc=0.08) = 0.08
    // investmentAmount = 10000 * 0.08 = 800, quantity = 800 / 50000 = 0.016
    const orderEntity = savedEntities.find((e) => e.side === 'BUY');
    expect(orderEntity).toBeDefined();
    expect(orderEntity.filledQuantity).toBeCloseTo(0.016, 6);
  });

  it('maps STOP_LOSS and TAKE_PROFIT signals to SELL action', async () => {
    const btcAccount = { currency: 'BTC', available: 1, total: 1, averageCost: 40000 };
    const ethAccount = { currency: 'ETH', available: 5, total: 5, averageCost: 2000 };
    const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

    const dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          findOne: jest.fn().mockImplementation((_entity: any, opts: any) => {
            const currency = opts?.where?.currency;
            if (currency === 'USD') return Promise.resolve({ ...quoteAccount });
            if (currency === 'BTC') return Promise.resolve({ ...btcAccount });
            if (currency === 'ETH') return Promise.resolve({ ...ethAccount });
            return Promise.resolve(null);
          }),
          create: jest.fn((_entity: any, data: any) => data),
          save: jest.fn((entity: any) => Promise.resolve(entity))
        })
      )
    };

    const {
      service,
      accountRepository,
      signalRepository,
      snapshotRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    accountRepository.find
      .mockResolvedValueOnce([quoteAccount, btcAccount, ethAccount])
      .mockResolvedValueOnce([quoteAccount, btcAccount, ethAccount]) // refresh after 1st order
      .mockResolvedValueOnce([quoteAccount, btcAccount, ethAccount]) // refresh after 2nd order
      .mockResolvedValueOnce([quoteAccount, btcAccount, ethAccount]);

    marketDataService.getPrices.mockResolvedValue(
      new Map([
        ['BTC/USD', { price: 50000 }],
        ['ETH/USD', { price: 3000 }]
      ])
    );
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 50000,
      slippageBps: 0,
      marketImpact: 0
    });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.STOP_LOSS,
          coinId: 'BTC',
          strength: 1.0,
          quantity: 0.5,
          confidence: 1.0,
          reason: 'stop loss triggered'
        },
        {
          type: SignalType.TAKE_PROFIT,
          coinId: 'ETH',
          strength: 1.0,
          quantity: 2,
          confidence: 1.0,
          reason: 'take profit triggered'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 10 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-risk',
      initialCapital: 50000,
      tickCount: 10,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    // Both STOP_LOSS and TAKE_PROFIT should be mapped to SELL and executed
    expect(result.signalsReceived).toBe(2);
    expect(result.ordersExecuted).toBe(2);
    expect(result.processed).toBe(true);

    // Verify slippage was called with 'SELL' for both (confirming STOP_LOSS/TAKE_PROFIT mapped to SELL)
    expect(marketDataService.calculateRealisticSlippage).toHaveBeenCalledWith(
      'binance',
      'BTC/USD',
      expect.any(Number),
      'SELL'
    );
    expect(marketDataService.calculateRealisticSlippage).toHaveBeenCalledWith(
      'binance',
      'ETH/USD',
      expect.any(Number),
      'SELL'
    );
  });

  describe('hold period enforcement', () => {
    it('blocks SELL when hold period not met', async () => {
      const now = new Date();
      const twelveHoursAgo = new Date(now.getTime() - 12 * 3600000);
      const btcAccount = { currency: 'BTC', available: 1, total: 1, averageCost: 40000, entryDate: twelveHoursAgo };
      const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(quoteAccount)
              .mockResolvedValueOnce({ ...btcAccount }),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => Promise.resolve(entity))
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, btcAccount])
        .mockResolvedValueOnce([quoteAccount, btcAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.SELL, coinId: 'BTC', strength: 0.5, quantity: 0.5, confidence: 0.9, reason: 'exit' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 25 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      const session = {
        id: 'session-hold-blocked',
        initialCapital: 50000,
        tickCount: 1,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(0);
      expect(result.processed).toBe(true);
    });

    it('allows SELL when hold period is met', async () => {
      const now = new Date();
      const fortyEightHoursAgo = new Date(now.getTime() - 48 * 3600000);
      const btcAccount = {
        currency: 'BTC',
        available: 1,
        total: 1,
        averageCost: 40000,
        entryDate: fortyEightHoursAgo
      };
      const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(quoteAccount)
              .mockResolvedValueOnce({ ...btcAccount }),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => Promise.resolve(entity))
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, btcAccount])
        .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after successful order
        .mockResolvedValueOnce([quoteAccount, btcAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.SELL, coinId: 'BTC', strength: 0.5, quantity: 0.5, confidence: 0.9, reason: 'exit' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 25 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-hold-allowed',
        initialCapital: 50000,
        tickCount: 10,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(1);
      expect(result.processed).toBe(true);
    });

    it('STOP_LOSS bypasses hold period', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 1 * 3600000);
      const btcAccount = { currency: 'BTC', available: 1, total: 1, averageCost: 40000, entryDate: oneHourAgo };
      const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(quoteAccount)
              .mockResolvedValueOnce({ ...btcAccount }),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => Promise.resolve(entity))
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, btcAccount])
        .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after successful order
        .mockResolvedValueOnce([quoteAccount, btcAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          {
            type: SignalType.STOP_LOSS,
            coinId: 'BTC',
            strength: 1.0,
            quantity: 1,
            confidence: 1.0,
            reason: 'stop loss triggered'
          }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 50 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-hold-stoploss',
        initialCapital: 50000,
        tickCount: 10,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(1);
      expect(result.processed).toBe(true);
    });

    it('sets entryDate on first BUY', async () => {
      const savedEntities: any[] = [];
      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({ currency: 'USD', available: 10000, total: 10000 })
              .mockResolvedValueOnce(null),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => {
              savedEntities.push({ ...entity });
              return Promise.resolve(entity);
            })
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator
      } = createService({ dataSource });

      const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
      accountRepository.find
        .mockResolvedValueOnce([quoteAccount])
        .mockResolvedValueOnce([quoteAccount]) // refresh after successful order
        .mockResolvedValueOnce([quoteAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.05, quantity: 0.01, confidence: 0.8, reason: 'entry' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 0.5 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-entry-date',
        initialCapital: 10000,
        tickCount: 10,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(1);
      // The new account should have entryDate set (created with entryDate in the create call)
      const btcAccount = savedEntities.find((e) => e.currency === 'BTC');
      expect(btcAccount).toBeDefined();
      expect(btcAccount.entryDate).toBeInstanceOf(Date);
    });

    it('skips add-to BUY when position already held (duplicate guard)', async () => {
      const existingBtcAccount = {
        currency: 'BTC',
        available: 0.5,
        total: 0.5,
        averageCost: 45000,
        entryDate: new Date('2024-01-01T00:00:00Z')
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry
      } = createService();

      const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
      accountRepository.find.mockResolvedValue([quoteAccount, existingBtcAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.05, quantity: 0.01, confidence: 0.8, reason: 'add to' }
        ]
      });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-preserve-entry',
        initialCapital: 10000,
        tickCount: 10,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      // BUY should be skipped because BTC position is already held
      expect(result.ordersExecuted).toBe(0);
      // Signal should not be saved (skipped before saveSignal)
      expect(signalRepository.save).not.toHaveBeenCalled();
      expect(result.processed).toBe(true);
    });

    it('clears entryDate on full sell', async () => {
      const now = new Date();
      const twoDaysAgo = new Date(now.getTime() - 48 * 3600000);
      const btcAccount = { currency: 'BTC', available: 0.5, total: 0.5, averageCost: 40000, entryDate: twoDaysAgo };
      const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

      const savedEntities: any[] = [];
      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(quoteAccount)
              .mockResolvedValueOnce({ ...btcAccount }),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => {
              savedEntities.push({ ...entity });
              return Promise.resolve(entity);
            })
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, btcAccount])
        .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after successful order
        .mockResolvedValueOnce([quoteAccount, btcAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          {
            type: SignalType.SELL,
            coinId: 'BTC',
            strength: 1.0,
            quantity: 0.5,
            confidence: 0.9,
            reason: 'close position'
          }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 25 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-clear-entry',
        initialCapital: 50000,
        tickCount: 10,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(1);
      const baseAccountSave = savedEntities.find((e) => e.currency === 'BTC' && e.available === 0);
      expect(baseAccountSave).toBeDefined();
      expect(baseAccountSave.entryDate).toBeUndefined();
      expect(baseAccountSave.averageCost).toBeUndefined();
    });

    it('uses custom minHoldMs from algorithmConfig', async () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - 2 * 3600000);
      const btcAccount = { currency: 'BTC', available: 1, total: 1, averageCost: 40000, entryDate: twoHoursAgo };
      const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(quoteAccount)
              .mockResolvedValueOnce({ ...btcAccount }),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => Promise.resolve(entity))
          })
        )
      };

      const { service, accountRepository, signalRepository, marketDataService, algorithmRegistry, feeCalculator } =
        createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, btcAccount])
        .mockResolvedValueOnce([quoteAccount, btcAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.SELL, coinId: 'BTC', strength: 0.5, quantity: 0.5, confidence: 0.9, reason: 'exit' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 25 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      // Custom minHoldMs of 4 hours — held only 2h, should be rejected
      const session = {
        id: 'session-custom-hold',
        initialCapital: 50000,
        tickCount: 1,
        tradingFee: 0.001,
        algorithmConfig: { minHoldMs: 4 * 3600000 },
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(0);
      expect(result.processed).toBe(true);
    });
  });

  describe('regime gate filtering', () => {
    it('blocks BUY signals in BEAR regime', async () => {
      const compositeRegimeService = {
        getCompositeRegime: jest.fn().mockReturnValue(CompositeRegimeType.BEAR),
        getVolatilityRegime: jest.fn().mockReturnValue(MarketRegimeType.NORMAL)
      };

      const signalFilterChain = {
        apply: jest.fn().mockImplementation((signals: any[], _ctx: any, allocation: any) => ({
          signals: signals.filter((s: any) => s.action !== 'BUY'),
          maxAllocation: allocation.maxAllocation * 0.1,
          minAllocation: allocation.minAllocation * 0.1,
          regimeGateBlockedCount: signals.filter((s: any) => s.action === 'BUY').length,
          regimeMultiplier: 0.1
        }))
      };

      const {
        service,
        accountRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        signalRepository
      } = createService({ compositeRegimeService, signalFilterChain });

      const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
      accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.1, quantity: 0.01, confidence: 0.8, reason: 'entry' }
        ]
      });

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-bear',
        initialCapital: 10000,
        tickCount: 10,
        riskLevel: 3,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(signalFilterChain.apply).toHaveBeenCalled();
      expect(result.ordersExecuted).toBe(0);
      expect(result.processed).toBe(true);
    });

    it('allows STOP_LOSS through in BEAR regime', async () => {
      const btcAccount = { currency: 'BTC', available: 1, total: 1, averageCost: 40000 };
      const quoteAccount = { currency: 'USD', available: 5000, total: 5000 };

      const compositeRegimeService = {
        getCompositeRegime: jest.fn().mockReturnValue(CompositeRegimeType.BEAR),
        getVolatilityRegime: jest.fn().mockReturnValue(MarketRegimeType.NORMAL)
      };

      // Passthrough: STOP_LOSS mapped to SELL passes the gate
      const signalFilterChain = {
        apply: jest.fn().mockImplementation((signals: any[], _ctx: any, allocation: any) => ({
          signals,
          maxAllocation: allocation.maxAllocation * 0.1,
          minAllocation: allocation.minAllocation * 0.1,
          regimeGateBlockedCount: 0,
          regimeMultiplier: 0.1
        }))
      };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce(quoteAccount)
              .mockResolvedValueOnce({ ...btcAccount }),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => Promise.resolve(entity))
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator
      } = createService({ compositeRegimeService, signalFilterChain, dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, btcAccount])
        .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after successful order
        .mockResolvedValueOnce([quoteAccount, btcAccount]);

      marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          {
            type: SignalType.STOP_LOSS,
            coinId: 'BTC',
            strength: 1.0,
            quantity: 0.5,
            confidence: 1.0,
            reason: 'stop loss'
          }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 25 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-bear-sl',
        initialCapital: 50000,
        tickCount: 10,
        tradingFee: 0.001,
        riskLevel: 3,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(1);
      expect(result.processed).toBe(true);
    });
  });

  it('processes multiple signals in a single tick and counts all executed orders', async () => {
    const btcAccount = { currency: 'BTC', available: 2, total: 2, averageCost: 40000 };
    const quoteAccount = { currency: 'USD', available: 50000, total: 50000 };
    let orderCount = 0;

    const dataSource = {
      transaction: jest.fn((callback: any) =>
        callback({
          findOne: jest.fn().mockImplementation((_entity: any, opts: any) => {
            const currency = opts?.where?.currency;
            if (currency === 'USD') return Promise.resolve({ ...quoteAccount });
            if (currency === 'BTC') return Promise.resolve({ ...btcAccount });
            if (currency === 'ETH') return Promise.resolve(null); // New position
            return Promise.resolve(null);
          }),
          create: jest.fn((_entity: any, data: any) => data),
          save: jest.fn((entity: any) => {
            if (entity.side) orderCount++;
            return Promise.resolve(entity);
          })
        })
      )
    };

    const {
      service,
      accountRepository,
      signalRepository,
      snapshotRepository,
      orderRepository,
      marketDataService,
      algorithmRegistry,
      feeCalculator
    } = createService({ dataSource });

    accountRepository.find
      .mockResolvedValueOnce([quoteAccount, btcAccount])
      .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after 1st order
      .mockResolvedValueOnce([quoteAccount, btcAccount]) // refresh after 2nd order
      .mockResolvedValueOnce([quoteAccount, btcAccount]);

    marketDataService.getPrices.mockResolvedValue(
      new Map([
        ['BTC/USD', { price: 50000 }],
        ['ETH/USD', { price: 3000 }]
      ])
    );
    marketDataService.calculateRealisticSlippage
      .mockResolvedValueOnce({ estimatedPrice: 50000, slippageBps: 0, marketImpact: 0 })
      .mockResolvedValueOnce({ estimatedPrice: 3000, slippageBps: 0, marketImpact: 0 });

    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [
        {
          type: SignalType.SELL,
          coinId: 'BTC',
          strength: 0.5,
          quantity: 0.5,
          confidence: 0.9,
          reason: 'partial exit'
        },
        {
          type: SignalType.BUY,
          coinId: 'ETH',
          strength: 0.1,
          quantity: 1,
          confidence: 0.7,
          reason: 'new entry'
        }
      ]
    });

    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

    signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = {
      id: 'session-multi',
      initialCapital: 50000,
      tickCount: 10,
      tradingFee: 0.001,
      user: { id: 'user-1' }
    } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.signalsReceived).toBe(2);
    expect(result.ordersExecuted).toBe(2);
    expect(result.processed).toBe(true);
  });

  describe('stale portfolio refresh', () => {
    it('second BUY signal in same tick uses refreshed portfolio values', async () => {
      const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
      const savedOrders: any[] = [];

      // Track portfolio.totalValue passed to executeOrder across calls
      let txCallCount = 0;
      const dataSource = {
        transaction: jest.fn((callback: any) => {
          txCallCount++;
          // Both BUY transactions succeed
          return callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({
                currency: 'USD',
                available: txCallCount === 1 ? 10000 : 9200,
                total: txCallCount === 1 ? 10000 : 9200
              })
              .mockResolvedValueOnce(
                txCallCount === 1 ? null : { currency: 'ETH', available: 0, total: 0, averageCost: 0 }
              ),
            create: jest.fn((_entity: any, data: any) => data),
            save: jest.fn((entity: any) => {
              if (entity.side) savedOrders.push({ ...entity, txCall: txCallCount });
              return Promise.resolve(entity);
            })
          });
        })
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator
      } = createService({ dataSource });

      // Initial accounts, then refreshed after first BUY, refreshed after second BUY, then final
      accountRepository.find
        .mockResolvedValueOnce([quoteAccount]) // step 1: initial
        .mockResolvedValueOnce([
          { currency: 'USD', available: 9200, total: 9200 },
          { currency: 'BTC', available: 0.016, total: 0.016, averageCost: 50000 }
        ]) // refresh after 1st BUY
        .mockResolvedValueOnce([
          { currency: 'USD', available: 8400, total: 8400 },
          { currency: 'BTC', available: 0.016, total: 0.016 },
          { currency: 'ETH', available: 0.27, total: 0.27 }
        ]) // refresh after 2nd BUY
        .mockResolvedValueOnce([
          { currency: 'USD', available: 8400, total: 8400 },
          { currency: 'BTC', available: 0.016, total: 0.016 },
          { currency: 'ETH', available: 0.27, total: 0.27 }
        ]); // final

      marketDataService.getPrices.mockResolvedValue(
        new Map([
          ['BTC/USD', { price: 50000 }],
          ['ETH/USD', { price: 3000 }]
        ])
      );
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.08, confidence: 0.8, reason: 'entry BTC' },
          { type: SignalType.BUY, coinId: 'ETH', strength: 0.08, confidence: 0.8, reason: 'entry ETH' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 1 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-refresh',
        initialCapital: 10000,
        tickCount: 10,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.ordersExecuted).toBe(2);
      expect(result.processed).toBe(true);

      // Portfolio should be refreshed between the two BUYs
      // accountRepository.find should be called 4 times:
      //   1. initial load, 2. refresh after 1st BUY, 3. refresh after 2nd BUY, 4. final accounts
      expect(accountRepository.find).toHaveBeenCalledTimes(4);
    });
  });

  describe('opportunity selling', () => {
    it('attempts opportunity selling when BUY has insufficient cash and oppSelling enabled', async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 72 * 3600000);
      const ethAccount = {
        currency: 'ETH',
        available: 5,
        total: 5,
        averageCost: 2800,
        entryDate: threeDaysAgo
      };
      const quoteAccount = { currency: 'USD', available: 50, total: 50 };

      // First call: executeOrder for BUY returns null (insufficient cash)
      // Then opportunity sell executes, then retry BUY succeeds
      let txCallCount = 0;
      const dataSource = {
        transaction: jest.fn((callback: any) => {
          txCallCount++;
          if (txCallCount === 1) {
            // First BUY attempt — insufficient cash, returns null
            return callback({
              findOne: jest
                .fn()
                .mockResolvedValueOnce({ ...quoteAccount }) // quote
                .mockResolvedValueOnce(null), // no BTC account
              create: jest.fn((_e: any, d: any) => d),
              save: jest.fn((e: any) => Promise.resolve(e))
            });
          }
          if (txCallCount === 2) {
            // Opportunity sell of ETH
            return callback({
              findOne: jest
                .fn()
                .mockResolvedValueOnce({ ...quoteAccount }) // quote
                .mockResolvedValueOnce({ ...ethAccount }), // ETH to sell
              create: jest.fn((_e: any, d: any) => d),
              save: jest.fn((e: any) => Promise.resolve(e))
            });
          }
          // Retry BUY — now has enough cash
          return callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({ currency: 'USD', available: 5000, total: 5000 })
              .mockResolvedValueOnce(null),
            create: jest.fn((_e: any, d: any) => d),
            save: jest.fn((e: any) => Promise.resolve(e))
          });
        })
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator,
        positionAnalysis
      } = createService({ dataSource });

      // processTick accounts (initial + opp selling + retry BUY + refresh + final)
      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, ethAccount]) // step 1: initial accounts
        .mockResolvedValueOnce([quoteAccount, ethAccount]) // opportunity selling: fresh accounts
        .mockResolvedValueOnce([quoteAccount, ethAccount]) // opportunity selling: fresh accounts for executeOrder
        .mockResolvedValueOnce([{ currency: 'USD', available: 5000, total: 5000 }]) // retry BUY: fresh accounts
        .mockResolvedValueOnce([{ currency: 'USD', available: 4000, total: 4000 }]) // refresh after successful retry BUY
        .mockResolvedValueOnce([{ currency: 'USD', available: 4000, total: 4000 }]); // step 7: final accounts

      marketDataService.getPrices.mockResolvedValue(
        new Map([
          ['BTC/USD', { price: 50000 }],
          ['ETH/USD', { price: 3000 }]
        ])
      );
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          {
            type: SignalType.BUY,
            coinId: 'BTC',
            strength: 0.05,
            quantity: 0.1,
            confidence: 0.85,
            reason: 'strong entry'
          }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

      positionAnalysis.calculatePositionSellScore.mockReturnValue({
        eligible: true,
        totalScore: 10,
        unrealizedPnLScore: 5,
        protectedGainsScore: 0,
        holdingPeriodScore: 3,
        opportunityAdvantageScore: 2,
        algorithmRankingScore: 0,
        unrealizedPnLPercent: 7.1,
        holdingPeriodHours: 72
      });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-oppsell',
        initialCapital: 20000,
        tickCount: 10,
        tradingFee: 0.001,
        algorithmConfig: {
          enableOpportunitySelling: true,
          opportunitySellingConfig: {
            minOpportunityConfidence: 0.7,
            minHoldingPeriodHours: 48,
            protectGainsAbovePercent: 15,
            protectedCoins: [],
            minOpportunityAdvantagePercent: 10,
            maxLiquidationPercent: 30,
            useAlgorithmRanking: true
          }
        },
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.processed).toBe(true);
      expect(positionAnalysis.calculatePositionSellScore).toHaveBeenCalled();
      // Should have executed at least 1 opportunity sell + the retry BUY
      expect(result.ordersExecuted).toBeGreaterThanOrEqual(2);
    });

    it('skips opportunity selling when disabled', async () => {
      const quoteAccount = { currency: 'USD', available: 50, total: 50 };
      const ethAccount = { currency: 'ETH', available: 5, total: 5, averageCost: 2800 };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({ ...quoteAccount })
              .mockResolvedValueOnce(null),
            create: jest.fn((_e: any, d: any) => d),
            save: jest.fn((e: any) => Promise.resolve(e))
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator,
        positionAnalysis
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, ethAccount])
        .mockResolvedValueOnce([quoteAccount, ethAccount]);

      marketDataService.getPrices.mockResolvedValue(
        new Map([
          ['BTC/USD', { price: 50000 }],
          ['ETH/USD', { price: 3000 }]
        ])
      );
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.05, quantity: 0.1, confidence: 0.85, reason: 'entry' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      // No enableOpportunitySelling in config — defaults to disabled
      const session = {
        id: 'session-oppsell-disabled',
        initialCapital: 20000,
        tickCount: 1,
        tradingFee: 0.001,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.processed).toBe(true);
      expect(result.ordersExecuted).toBe(0);
      expect(positionAnalysis.calculatePositionSellScore).not.toHaveBeenCalled();
    });

    it('does NOT trigger opportunity selling when BUY fails due to no price data', async () => {
      const ethAccount = { currency: 'ETH', available: 5, total: 5, averageCost: 2800 };
      const quoteAccount = { currency: 'USD', available: 50, total: 50 };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({ ...quoteAccount })
              .mockResolvedValueOnce(null),
            create: jest.fn((_e: any, d: any) => d),
            save: jest.fn((e: any) => Promise.resolve(e))
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator,
        positionAnalysis
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, ethAccount])
        .mockResolvedValueOnce([quoteAccount, ethAccount]);

      // BTC has no price data — only ETH has a price
      marketDataService.getPrices.mockResolvedValue(new Map([['ETH/USD', { price: 3000 }]]));
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.05, quantity: 0.1, confidence: 0.85, reason: 'entry' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      const session = {
        id: 'session-noprice-nooppsell',
        initialCapital: 20000,
        tickCount: 1,
        tradingFee: 0.001,
        algorithmConfig: { enableOpportunitySelling: true },
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.processed).toBe(true);
      expect(result.ordersExecuted).toBe(0);
      // Opportunity selling should NOT be triggered for no_price failures
      expect(positionAnalysis.calculatePositionSellScore).not.toHaveBeenCalled();
    });

    it('triggers opportunity selling when BUY fails due to insufficient funds', async () => {
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 72 * 3600000);
      const ethAccount = {
        currency: 'ETH',
        available: 5,
        total: 5,
        averageCost: 2800,
        entryDate: threeDaysAgo
      };
      const quoteAccount = { currency: 'USD', available: 50, total: 50 };

      let txCallCount = 0;
      const dataSource = {
        transaction: jest.fn((callback: any) => {
          txCallCount++;
          if (txCallCount === 1) {
            // First BUY attempt — insufficient cash
            return callback({
              findOne: jest
                .fn()
                .mockResolvedValueOnce({ ...quoteAccount })
                .mockResolvedValueOnce(null),
              create: jest.fn((_e: any, d: any) => d),
              save: jest.fn((e: any) => Promise.resolve(e))
            });
          }
          if (txCallCount === 2) {
            // Opportunity sell of ETH
            return callback({
              findOne: jest
                .fn()
                .mockResolvedValueOnce({ ...quoteAccount })
                .mockResolvedValueOnce({ ...ethAccount }),
              create: jest.fn((_e: any, d: any) => d),
              save: jest.fn((e: any) => Promise.resolve(e))
            });
          }
          // Retry BUY
          return callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({ currency: 'USD', available: 5000, total: 5000 })
              .mockResolvedValueOnce(null),
            create: jest.fn((_e: any, d: any) => d),
            save: jest.fn((e: any) => Promise.resolve(e))
          });
        })
      };

      const {
        service,
        accountRepository,
        signalRepository,
        snapshotRepository,
        orderRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator,
        positionAnalysis
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, ethAccount])
        .mockResolvedValueOnce([quoteAccount, ethAccount])
        .mockResolvedValueOnce([quoteAccount, ethAccount])
        .mockResolvedValueOnce([{ currency: 'USD', available: 5000, total: 5000 }])
        .mockResolvedValueOnce([{ currency: 'USD', available: 5000, total: 5000 }])
        .mockResolvedValueOnce([{ currency: 'USD', available: 4000, total: 4000 }]);

      marketDataService.getPrices.mockResolvedValue(
        new Map([
          ['BTC/USD', { price: 50000 }],
          ['ETH/USD', { price: 3000 }]
        ])
      );
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          { type: SignalType.BUY, coinId: 'BTC', strength: 0.05, quantity: 0.1, confidence: 0.85, reason: 'entry' }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

      positionAnalysis.calculatePositionSellScore.mockReturnValue({
        eligible: true,
        totalScore: 10,
        unrealizedPnLScore: 5,
        protectedGainsScore: 0,
        holdingPeriodScore: 3,
        opportunityAdvantageScore: 2,
        algorithmRankingScore: 0,
        unrealizedPnLPercent: 7.1,
        holdingPeriodHours: 72
      });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-insuff-oppsell',
        initialCapital: 20000,
        tickCount: 10,
        tradingFee: 0.001,
        algorithmConfig: {
          enableOpportunitySelling: true,
          opportunitySellingConfig: {
            minOpportunityConfidence: 0.7,
            minHoldingPeriodHours: 48,
            protectGainsAbovePercent: 15,
            protectedCoins: [],
            minOpportunityAdvantagePercent: 10,
            maxLiquidationPercent: 30,
            useAlgorithmRanking: true
          }
        },
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.processed).toBe(true);
      // Opportunity selling SHOULD be triggered for insufficient_funds
      expect(positionAnalysis.calculatePositionSellScore).toHaveBeenCalled();
      expect(result.ordersExecuted).toBeGreaterThanOrEqual(2);
    });

    it('skips opportunity selling when buy confidence below threshold', async () => {
      const quoteAccount = { currency: 'USD', available: 50, total: 50 };
      const ethAccount = { currency: 'ETH', available: 5, total: 5, averageCost: 2800 };

      const dataSource = {
        transaction: jest.fn((callback: any) =>
          callback({
            findOne: jest
              .fn()
              .mockResolvedValueOnce({ ...quoteAccount })
              .mockResolvedValueOnce(null),
            create: jest.fn((_e: any, d: any) => d),
            save: jest.fn((e: any) => Promise.resolve(e))
          })
        )
      };

      const {
        service,
        accountRepository,
        signalRepository,
        marketDataService,
        algorithmRegistry,
        feeCalculator,
        positionAnalysis
      } = createService({ dataSource });

      accountRepository.find
        .mockResolvedValueOnce([quoteAccount, ethAccount])
        .mockResolvedValueOnce([quoteAccount, ethAccount]);

      marketDataService.getPrices.mockResolvedValue(
        new Map([
          ['BTC/USD', { price: 50000 }],
          ['ETH/USD', { price: 3000 }]
        ])
      );
      marketDataService.calculateRealisticSlippage.mockResolvedValue({
        estimatedPrice: 50000,
        slippageBps: 0,
        marketImpact: 0
      });

      algorithmRegistry.executeAlgorithm.mockResolvedValue({
        success: true,
        signals: [
          {
            type: SignalType.BUY,
            coinId: 'BTC',
            strength: 0.05,
            quantity: 0.1,
            confidence: 0.3, // Below default threshold of 0.7
            reason: 'weak entry'
          }
        ]
      });

      feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
      feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

      signalRepository.create.mockReturnValue({ processed: false, rejectionCode: null });
      signalRepository.save.mockImplementation(async (value: any) => value);

      const session = {
        id: 'session-oppsell-lowconf',
        initialCapital: 20000,
        tickCount: 1,
        tradingFee: 0.001,
        algorithmConfig: { enableOpportunitySelling: true },
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      expect(result.processed).toBe(true);
      expect(result.ordersExecuted).toBe(0);
      // positionAnalysis should not be called because confidence gate rejects first
      expect(positionAnalysis.calculatePositionSellScore).not.toHaveBeenCalled();
    });
  });

  describe('getQuoteCurrency priority', () => {
    it('selects USDT over BTC/ETH regardless of account array order', async () => {
      const { service, accountRepository, marketDataService, algorithmRegistry, snapshotRepository, orderRepository } =
        createService();

      // Accounts in DB order: BTC first, then ETH, then USDT — bug would pick BTC
      const accounts = [
        { currency: 'BTC', available: 0.5, total: 0.5, averageCost: 60000 },
        { currency: 'ETH', available: 2, total: 2, averageCost: 3000 },
        { currency: 'USDT', available: 9729, total: 9729 }
      ];

      accountRepository.find
        .mockResolvedValueOnce(accounts) // initial fetch
        .mockResolvedValueOnce(accounts); // final fetch

      marketDataService.getPrices.mockResolvedValue(
        new Map([
          ['BTC/USDT', { price: 62000 }],
          ['ETH/USDT', { price: 3200 }]
        ])
      );

      algorithmRegistry.executeAlgorithm.mockResolvedValue({ success: true, signals: [] });

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-quote-priority',
        initialCapital: 10000,
        tickCount: 10,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'binance' } } as any;

      const result = await service.processTick(session, exchangeKey);

      // Should request BTC/USDT and ETH/USDT (not BTC/BTC or ETH/BTC)
      expect(marketDataService.getPrices).toHaveBeenCalledWith(
        'binance',
        expect.arrayContaining(['BTC/USDT', 'ETH/USDT'])
      );
      // Portfolio value should include USDT cash + positions, not near-zero
      expect(result.portfolioValue).toBeGreaterThan(9000);
      expect(result.processed).toBe(true);
    });

    it('selects USD over USDT when both present', async () => {
      const { service, accountRepository, marketDataService, algorithmRegistry, snapshotRepository, orderRepository } =
        createService();

      const accounts = [
        { currency: 'USDT', available: 500, total: 500 },
        { currency: 'USD', available: 9500, total: 9500 }
      ];

      accountRepository.find.mockResolvedValueOnce(accounts).mockResolvedValueOnce(accounts);

      marketDataService.getPrices.mockResolvedValue(new Map([['USDT/USD', { price: 1 }]]));
      algorithmRegistry.executeAlgorithm.mockResolvedValue({ success: true, signals: [] });

      orderRepository.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
      });

      snapshotRepository.create.mockReturnValue({});
      snapshotRepository.save.mockResolvedValue({});

      const session = {
        id: 'session-usd-priority',
        initialCapital: 10000,
        tickCount: 10,
        user: { id: 'user-1' }
      } as any;
      const exchangeKey = { exchange: { slug: 'coinbase' } } as any;

      const result = await service.processTick(session, exchangeKey);

      // Should use USD as quote, so USDT becomes a position priced as USDT/USD
      expect(marketDataService.getPrices).toHaveBeenCalledWith('coinbase', expect.arrayContaining(['USDT/USD']));
      expect(result.processed).toBe(true);
    });
  });

  it('does not produce duplicate signals when multiple symbols share a base currency', async () => {
    const { service, accountRepository, snapshotRepository, orderRepository, marketDataService, algorithmRegistry } =
      createService();

    const quoteAccount = { currency: 'USDT', available: 10000, total: 10000 };

    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

    // Two symbols sharing the same base currency (ETH)
    marketDataService.getPrices.mockResolvedValue(
      new Map([
        ['ETH/USDT', { price: 1900 }],
        ['ETH/BTC', { price: 0.05 }]
      ])
    );

    algorithmRegistry.executeAlgorithm.mockResolvedValue({ success: true, signals: [] });

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

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
