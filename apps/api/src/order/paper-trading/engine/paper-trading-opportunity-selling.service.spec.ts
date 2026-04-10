import { PaperTradingOpportunitySellingService } from './paper-trading-opportunity-selling.service';

import { PaperTradingSignalStatus } from '../entities';

describe('PaperTradingOpportunitySellingService', () => {
  let service: PaperTradingOpportunitySellingService;
  let portfolioService: {
    loadAccounts: jest.Mock;
    buildFromAccounts: jest.Mock;
    updateWithPrices: jest.Mock;
    refresh: jest.Mock;
  };
  let signalService: {
    save: jest.Mock;
    markProcessed: jest.Mock;
  };
  let feeCalculator: {
    fromFlatRate: jest.Mock;
    calculateFee: jest.Mock;
  };
  let positionAnalysis: {
    calculatePositionSellScore: jest.Mock;
  };
  let orderExecutor: {
    execute: jest.Mock;
  };

  const makePortfolio = (cashBalance: number, positions: Map<string, any> = new Map(), totalValue = 20000) => ({
    cashBalance,
    positions,
    totalValue
  });

  const makeSession = (overrides: any = {}): any => ({
    id: 'sess-1',
    tradingFee: 0.001,
    riskLevel: 3,
    algorithmConfig: { enableOpportunitySelling: true },
    ...overrides
  });

  beforeEach(() => {
    portfolioService = {
      loadAccounts: jest.fn(),
      buildFromAccounts: jest.fn().mockReturnValue({}),
      updateWithPrices: jest.fn(),
      refresh: jest.fn()
    };
    signalService = {
      save: jest.fn((_s, sig) => ({ id: 'sig-1', signal: sig })),
      markProcessed: jest.fn((e) => e)
    };
    feeCalculator = {
      fromFlatRate: jest.fn().mockReturnValue({ rate: 0.001 }),
      calculateFee: jest.fn().mockReturnValue({ fee: 5 })
    };
    positionAnalysis = {
      calculatePositionSellScore: jest.fn()
    };
    orderExecutor = {
      execute: jest.fn()
    };

    service = new PaperTradingOpportunitySellingService(
      portfolioService as any,
      signalService as any,
      feeCalculator as any,
      positionAnalysis as any,
      orderExecutor as any
    );
  });

  it('returns 0 when opportunity selling is disabled in config', async () => {
    const session = makeSession({ algorithmConfig: {} });
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', confidence: 0.9 };

    const result = await service.attempt(session, signal, { 'BTC/USD': 50000 }, 'USD', 'binance', new Date());

    expect(result).toBe(0);
    expect(portfolioService.loadAccounts).not.toHaveBeenCalled();
  });

  it('returns 0 when buy confidence is below minimum threshold', async () => {
    const session = makeSession();
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', confidence: 0.3 };

    const result = await service.attempt(session, signal, { 'BTC/USD': 50000 }, 'USD', 'binance', new Date());

    expect(result).toBe(0);
    expect(portfolioService.loadAccounts).not.toHaveBeenCalled();
  });

  it('sells a lower-scoring position to free cash and returns the number of sells executed', async () => {
    const session = makeSession();
    const signal: any = {
      action: 'BUY',
      coinId: 'BTC',
      symbol: 'BTC/USD',
      quantity: 0.1,
      confidence: 0.85
    };

    const ethAccount = { currency: 'ETH', averageCost: 2800, entryDate: new Date(Date.now() - 72 * 3600000) };
    portfolioService.loadAccounts.mockResolvedValue([ethAccount]);
    portfolioService.updateWithPrices.mockReturnValue(
      makePortfolio(
        100, // cash — far below required
        new Map([['ETH', { averagePrice: 2800, quantity: 5 }]]),
        20000
      )
    );
    portfolioService.refresh.mockResolvedValue({
      accounts: [],
      portfolio: makePortfolio(100, new Map(), 20000)
    });

    positionAnalysis.calculatePositionSellScore.mockReturnValue({
      eligible: true,
      totalScore: 10
    });

    orderExecutor.execute.mockResolvedValue({
      status: 'executed',
      order: { totalValue: 3000, fee: 3 }
    });

    const result = await service.attempt(
      session,
      signal,
      { 'BTC/USD': 50000, 'ETH/USD': 3000 },
      'USD',
      'binance',
      new Date()
    );

    expect(result).toBe(1);
    expect(positionAnalysis.calculatePositionSellScore).toHaveBeenCalled();
    expect(orderExecutor.execute).toHaveBeenCalledTimes(1);
    const execArg = orderExecutor.execute.mock.calls[0][0];
    expect(execArg.signal.action).toBe('SELL');
    expect(execArg.signal.coinId).toBe('ETH');
    expect(execArg.signal.symbol).toBe('ETH/USD');
    expect(execArg.signal.metadata).toEqual({ opportunitySell: true, targetBuyCoinId: 'BTC' });
    expect(execArg.signal.quantity).toBeGreaterThan(0);
    expect(signalService.markProcessed).toHaveBeenCalledTimes(1);
    const processedArg = signalService.markProcessed.mock.calls[0][0];
    expect(processedArg.status).toBe(PaperTradingSignalStatus.SIMULATED);
  });

  it('returns 0 when buy signal symbol has no price in the price map', async () => {
    const session = makeSession();
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', quantity: 0.1, confidence: 0.85 };

    portfolioService.loadAccounts.mockResolvedValue([]);
    portfolioService.updateWithPrices.mockReturnValue(makePortfolio(100, new Map(), 20000));

    const result = await service.attempt(session, signal, {}, 'USD', 'binance', new Date());

    expect(result).toBe(0);
    expect(orderExecutor.execute).not.toHaveBeenCalled();
  });

  it('excludes protectedCoins from sell candidates and returns 0 when nothing else is eligible', async () => {
    const session = makeSession({
      algorithmConfig: { enableOpportunitySelling: true, opportunitySellingConfig: { protectedCoins: ['ETH'] } }
    });
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', quantity: 0.1, confidence: 0.85 };

    portfolioService.loadAccounts.mockResolvedValue([{ currency: 'ETH', averageCost: 2800, entryDate: new Date() }]);
    portfolioService.updateWithPrices.mockReturnValue(
      makePortfolio(100, new Map([['ETH', { averagePrice: 2800, quantity: 5 }]]), 20000)
    );

    const result = await service.attempt(
      session,
      signal,
      { 'BTC/USD': 50000, 'ETH/USD': 3000 },
      'USD',
      'binance',
      new Date()
    );

    expect(result).toBe(0);
    expect(positionAnalysis.calculatePositionSellScore).not.toHaveBeenCalled();
    expect(orderExecutor.execute).not.toHaveBeenCalled();
  });

  it('returns 0 when all positions score as ineligible', async () => {
    const session = makeSession();
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', quantity: 0.1, confidence: 0.85 };

    portfolioService.loadAccounts.mockResolvedValue([{ currency: 'ETH', averageCost: 2800 }]);
    portfolioService.updateWithPrices.mockReturnValue(
      makePortfolio(100, new Map([['ETH', { averagePrice: 2800, quantity: 5 }]]), 20000)
    );
    positionAnalysis.calculatePositionSellScore.mockReturnValue({ eligible: false, totalScore: 0 });

    const result = await service.attempt(
      session,
      signal,
      { 'BTC/USD': 50000, 'ETH/USD': 3000 },
      'USD',
      'binance',
      new Date()
    );

    expect(result).toBe(0);
    expect(orderExecutor.execute).not.toHaveBeenCalled();
  });

  it('caps total liquidation at maxLiquidationPercent of portfolio value', async () => {
    // Default cap = 30% of 20000 = 6000. Shortfall is much larger — should still stop after cap.
    const session = makeSession();
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', quantity: 1, confidence: 0.85 };

    portfolioService.loadAccounts.mockResolvedValue([
      { currency: 'ETH', averageCost: 2800 },
      { currency: 'SOL', averageCost: 100 }
    ]);
    portfolioService.updateWithPrices.mockReturnValue(
      makePortfolio(
        0,
        new Map([
          ['ETH', { averagePrice: 2800, quantity: 5 }],
          ['SOL', { averagePrice: 100, quantity: 50 }]
        ]),
        20000
      )
    );
    portfolioService.refresh.mockResolvedValue({ accounts: [], portfolio: makePortfolio(0, new Map(), 20000) });
    positionAnalysis.calculatePositionSellScore.mockReturnValue({ eligible: true, totalScore: 10 });

    // Each sell returns ~6000 net — second iteration should be skipped because cap is reached.
    orderExecutor.execute.mockResolvedValue({
      status: 'executed',
      order: { totalValue: 6000, fee: 0 }
    });

    const result = await service.attempt(
      session,
      signal,
      { 'BTC/USD': 50000, 'ETH/USD': 3000, 'SOL/USD': 100 },
      'USD',
      'binance',
      new Date()
    );

    expect(result).toBe(1);
    expect(orderExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it('marks signal REJECTED when the order executor returns no order', async () => {
    const session = makeSession();
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', quantity: 0.1, confidence: 0.85 };

    portfolioService.loadAccounts.mockResolvedValue([{ currency: 'ETH', averageCost: 2800 }]);
    portfolioService.updateWithPrices.mockReturnValue(
      makePortfolio(100, new Map([['ETH', { averagePrice: 2800, quantity: 5 }]]), 20000)
    );
    portfolioService.refresh.mockResolvedValue({ accounts: [], portfolio: makePortfolio(100, new Map(), 20000) });
    positionAnalysis.calculatePositionSellScore.mockReturnValue({ eligible: true, totalScore: 10 });
    orderExecutor.execute.mockResolvedValue({ status: 'rejected', order: null });

    const result = await service.attempt(
      session,
      signal,
      { 'BTC/USD': 50000, 'ETH/USD': 3000 },
      'USD',
      'binance',
      new Date()
    );

    expect(result).toBe(0);
    const processedArg = signalService.markProcessed.mock.calls[0][0];
    expect(processedArg.status).toBe(PaperTradingSignalStatus.REJECTED);
    expect(processedArg.rejectionCode).toBeDefined();
  });

  it('marks signal ERROR and continues when the order executor throws', async () => {
    const session = makeSession();
    const signal: any = { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', quantity: 0.1, confidence: 0.85 };

    portfolioService.loadAccounts.mockResolvedValue([{ currency: 'ETH', averageCost: 2800 }]);
    portfolioService.updateWithPrices.mockReturnValue(
      makePortfolio(100, new Map([['ETH', { averagePrice: 2800, quantity: 5 }]]), 20000)
    );
    portfolioService.refresh.mockResolvedValue({ accounts: [], portfolio: makePortfolio(100, new Map(), 20000) });
    positionAnalysis.calculatePositionSellScore.mockReturnValue({ eligible: true, totalScore: 10 });
    orderExecutor.execute.mockRejectedValue(new Error('boom'));

    const result = await service.attempt(
      session,
      signal,
      { 'BTC/USD': 50000, 'ETH/USD': 3000 },
      'USD',
      'binance',
      new Date()
    );

    expect(result).toBe(0);
    const processedArg = signalService.markProcessed.mock.calls[0][0];
    expect(processedArg.status).toBe(PaperTradingSignalStatus.ERROR);
  });

  it('returns 0 when cashBalance already covers required amount (no shortfall)', async () => {
    const session = makeSession();
    const signal: any = {
      action: 'BUY',
      coinId: 'BTC',
      symbol: 'BTC/USD',
      quantity: 0.01,
      confidence: 0.85
    };

    portfolioService.loadAccounts.mockResolvedValue([]);
    portfolioService.updateWithPrices.mockReturnValue(makePortfolio(10000, new Map(), 20000));

    const result = await service.attempt(session, signal, { 'BTC/USD': 50000 }, 'USD', 'binance', new Date());

    expect(result).toBe(0);
    expect(orderExecutor.execute).not.toHaveBeenCalled();
  });
});
