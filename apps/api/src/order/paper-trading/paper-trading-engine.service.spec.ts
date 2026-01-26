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
    calculateRealisticSlippage: jest.fn()
  };

  const algorithmRegistry = {
    executeAlgorithm: jest.fn()
  };

  const slippageService = {};
  const feeCalculator = {
    fromFlatRate: jest.fn(),
    calculateFee: jest.fn()
  };
  const positionManager = {};
  const metricsCalculator = {
    calculateSharpeRatio: jest.fn()
  };
  const portfolioState = {};

  return {
    service: new PaperTradingEngineService(
      overrides.accountRepository ?? (accountRepository as any),
      overrides.orderRepository ?? (orderRepository as any),
      overrides.signalRepository ?? (signalRepository as any),
      overrides.snapshotRepository ?? (snapshotRepository as any),
      overrides.dataSource ?? (dataSource as any),
      overrides.marketDataService ?? (marketDataService as any),
      overrides.algorithmRegistry ?? (algorithmRegistry as any),
      overrides.slippageService ?? (slippageService as any),
      overrides.feeCalculator ?? (feeCalculator as any),
      overrides.positionManager ?? (positionManager as any),
      overrides.metricsCalculator ?? (metricsCalculator as any),
      overrides.portfolioState ?? (portfolioState as any)
    ),
    accountRepository,
    orderRepository,
    signalRepository,
    snapshotRepository,
    metricsCalculator
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
    const { service, accountRepository, snapshotRepository, orderRepository } = createService();

    accountRepository.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ currency: 'USD', available: 1000, total: 1000 }]);

    const prices = new Map<string, { price: number }>([
      ['BTC/USD', { price: 50000 }],
      ['ETH/USD', { price: 3000 }]
    ]);

    const marketDataService = (service as any).marketDataService;
    marketDataService.getPrices.mockResolvedValue(prices);

    const algorithmRegistry = (service as any).algorithmRegistry;
    algorithmRegistry.executeAlgorithm.mockResolvedValue({ success: true, signals: [] });

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = { id: 'session-2', initialCapital: 1000, tickCount: 10 } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(marketDataService.getPrices).toHaveBeenCalledWith('binance', ['BTC/USD', 'ETH/USD']);
    expect(snapshotRepository.save).toHaveBeenCalled();
    expect(result.processed).toBe(true);
  });

  it('skips buy when balance is insufficient', async () => {
    const { service, accountRepository, signalRepository, orderRepository } = createService();

    const quoteAccount = { currency: 'USD', available: 50, total: 50 };

    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);
    accountRepository.findOne.mockResolvedValueOnce(quoteAccount).mockResolvedValueOnce(null);

    const marketDataService = (service as any).marketDataService;
    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 100 }]]));
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 100,
      slippageBps: 0,
      marketImpact: 0
    });

    const algorithmRegistry = (service as any).algorithmRegistry;
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

    const feeCalculator = (service as any).feeCalculator;
    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 1 });

    signalRepository.create.mockReturnValue({ processed: false });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.save.mockResolvedValue({});

    const session = { id: 'session-3', initialCapital: 1000, tickCount: 1, tradingFee: 0.001 } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

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

    const { service, accountRepository, signalRepository, snapshotRepository, orderRepository } = createService({
      dataSource
    });

    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
    accountRepository.find
      .mockResolvedValueOnce([quoteAccount])
      .mockResolvedValueOnce([quoteAccount, { currency: 'BTC', available: 0.1, total: 0.1 }]);

    const marketDataService = (service as any).marketDataService;
    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    // Slippage of 10 bps means price increases by 0.1% for BUY
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 50050, // 50000 * (1 + 10/10000)
      slippageBps: 10,
      marketImpact: 5
    });

    const algorithmRegistry = (service as any).algorithmRegistry;
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

    const feeCalculator = (service as any).feeCalculator;
    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 5 });

    signalRepository.create.mockReturnValue({ processed: false });
    signalRepository.save.mockImplementation(async (value: any) => value);

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = { id: 'session-slippage', initialCapital: 10000, tickCount: 10, tradingFee: 0.001 } as any;
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

    const { service, accountRepository, signalRepository, snapshotRepository, orderRepository } = createService({
      dataSource
    });

    accountRepository.find
      .mockResolvedValueOnce([quoteAccount, btcAccount])
      .mockResolvedValueOnce([quoteAccount, btcAccount]);

    const marketDataService = (service as any).marketDataService;
    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    // Slippage for SELL - price decreases
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 49950, // 50000 * (1 - 10/10000)
      slippageBps: 10,
      marketImpact: 5
    });

    const algorithmRegistry = (service as any).algorithmRegistry;
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

    const feeCalculator = (service as any).feeCalculator;
    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 25 });

    signalRepository.create.mockReturnValue({ processed: false });
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
      peakPortfolioValue: 51000
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

    const { service, accountRepository, signalRepository, orderRepository } = createService({
      dataSource
    });

    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

    const marketDataService = (service as any).marketDataService;
    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));
    marketDataService.calculateRealisticSlippage.mockResolvedValue({
      estimatedPrice: 49950,
      slippageBps: 10,
      marketImpact: 5
    });

    const algorithmRegistry = (service as any).algorithmRegistry;
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

    const feeCalculator = (service as any).feeCalculator;
    feeCalculator.fromFlatRate.mockReturnValue({ rate: 0.001 });
    feeCalculator.calculateFee.mockReturnValue({ fee: 50 });

    signalRepository.create.mockReturnValue({ processed: false });
    signalRepository.save.mockImplementation(async (value: any) => value);

    const session = { id: 'session-no-pos', initialCapital: 10000, tickCount: 1, tradingFee: 0.001 } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });

  it('handles algorithm returning no signals gracefully', async () => {
    const { service, accountRepository, snapshotRepository, orderRepository } = createService();

    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

    const marketDataService = (service as any).marketDataService;
    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));

    const algorithmRegistry = (service as any).algorithmRegistry;
    algorithmRegistry.executeAlgorithm.mockResolvedValue({
      success: true,
      signals: [] // No signals
    });

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = { id: 'session-no-signals', initialCapital: 10000, tickCount: 10 } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.signalsReceived).toBe(0);
    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });

  it('handles algorithm execution failure gracefully', async () => {
    const { service, accountRepository, snapshotRepository, orderRepository } = createService();

    const quoteAccount = { currency: 'USD', available: 10000, total: 10000 };
    accountRepository.find.mockResolvedValueOnce([quoteAccount]).mockResolvedValueOnce([quoteAccount]);

    const marketDataService = (service as any).marketDataService;
    marketDataService.getPrices.mockResolvedValue(new Map([['BTC/USD', { price: 50000 }]]));

    const algorithmRegistry = (service as any).algorithmRegistry;
    algorithmRegistry.executeAlgorithm.mockRejectedValue(new Error('Algorithm failed'));

    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 0 })
    });

    snapshotRepository.create.mockReturnValue({});
    snapshotRepository.save.mockResolvedValue({});

    const session = { id: 'session-algo-fail', initialCapital: 10000, tickCount: 10 } as any;
    const exchangeKey = { exchange: { slug: 'binance' } } as any;

    const result = await service.processTick(session, exchangeKey);

    expect(result.signalsReceived).toBe(0);
    expect(result.ordersExecuted).toBe(0);
    expect(result.processed).toBe(true);
  });
});
