import { SignalReasonCode } from '@chansey/api-interfaces';

import { PaperTradingExitExecutorService } from './paper-trading-exit-executor.service';

import { PaperTradingSignalStatus, PaperTradingSession } from '../entities';

describe('PaperTradingExitExecutorService', () => {
  let service: PaperTradingExitExecutorService;
  let portfolioService: { refresh: jest.Mock };
  let signalService: { save: jest.Mock; markProcessed: jest.Mock };
  let orderExecutor: { execute: jest.Mock };

  beforeEach(() => {
    portfolioService = {
      refresh: jest.fn().mockResolvedValue({
        accounts: [],
        portfolio: { cashBalance: 0, positions: new Map(), totalValue: 0 }
      })
    };
    signalService = {
      save: jest.fn(async () => ({ id: 'sig-1' })),
      markProcessed: jest.fn(async (e) => e)
    };
    orderExecutor = { execute: jest.fn() };

    service = new PaperTradingExitExecutorService(portfolioService as any, signalService as any, orderExecutor as any);
  });

  const makeSession = (overrides: Partial<PaperTradingSession> = {}): PaperTradingSession =>
    ({
      id: 'sess-1',
      riskLevel: 3,
      exitConfig: { stopLossPercent: 5, takeProfitPercent: 10, atrPeriod: 14 },
      ...overrides
    }) as any;

  const installFakeTracker = (sessionId: string, exitSignals: any[] = []) => {
    const fakeTracker = {
      size: exitSignals.length || 1,
      checkExits: jest.fn().mockReturnValue(exitSignals),
      removePosition: jest.fn(),
      onBuy: jest.fn(),
      onSell: jest.fn(),
      serialize: jest.fn().mockReturnValue({ positions: [] })
    };
    (service as any).exitTrackers.set(sessionId, fakeTracker);
    return fakeTracker;
  };

  describe('map lifecycle', () => {
    it('getOrCreate returns null when session has no exitConfig', () => {
      expect(service.getOrCreate(makeSession({ exitConfig: undefined }))).toBeNull();
    });

    it('getOrCreate creates a tracker and caches it', () => {
      const session = makeSession();
      const first = service.getOrCreate(session);
      const second = service.getOrCreate(session);
      expect(first).not.toBeNull();
      expect(first).toBe(second);
    });

    it('clear removes the tracker', () => {
      const session = makeSession();
      service.getOrCreate(session);
      service.clear(session.id);
      expect(service.serialize(session.id)).toBeUndefined();
    });

    it('serialize returns undefined when no tracker exists', () => {
      expect(service.serialize('missing')).toBeUndefined();
    });

    it('serialize delegates to the tracker when one exists', () => {
      const tracker = installFakeTracker('sess-1');
      expect(service.serialize('sess-1')).toEqual({ positions: [] });
      expect(tracker.serialize).toHaveBeenCalledTimes(1);
    });

    it('sweep removes trackers whose session id is not in the active set', () => {
      service.getOrCreate(makeSession({ id: 'a' }));
      service.getOrCreate(makeSession({ id: 'b' }));
      service.getOrCreate(makeSession({ id: 'c' }));

      expect(service.sweep(new Set(['b']))).toBe(2);
      expect(service.serialize('a')).toBeUndefined();
      expect(service.serialize('b')).toBeDefined();
      expect(service.serialize('c')).toBeUndefined();
    });
  });

  describe('onBuyFill', () => {
    it('is a no-op when no tracker exists for the session', () => {
      const session = makeSession({ exitConfig: undefined });
      expect(() =>
        service.onBuyFill(
          session,
          { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', reason: 'x' },
          { executedPrice: 100, filledQuantity: 1 } as any,
          {}
        )
      ).not.toThrow();
    });

    it('registers the buy on the tracker when executedPrice is valid', () => {
      const tracker = installFakeTracker('sess-1');
      service.onBuyFill(
        makeSession(),
        { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', reason: 'x' },
        { executedPrice: 100, filledQuantity: 2 } as any,
        {}
      );
      expect(tracker.onBuy).toHaveBeenCalledWith('BTC', 100, 2, undefined);
    });

    it('computes ATR from historical candles and passes it to tracker.onBuy', () => {
      const tracker = installFakeTracker('sess-1');
      const candles = Array.from({ length: 15 }, (_, i) => ({
        high: 110 + i,
        low: 90 + i,
        avg: 100 + i,
        date: new Date()
      }));
      service.onBuyFill(
        makeSession(),
        { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', reason: 'x' },
        { executedPrice: 100, filledQuantity: 1 } as any,
        { 'BTC/USD': candles as any }
      );
      const atrArg = tracker.onBuy.mock.calls[0][3];
      expect(typeof atrArg).toBe('number');
      expect(atrArg).toBeGreaterThan(0);
    });

    it('skips tracker registration when executedPrice is invalid', () => {
      const tracker = installFakeTracker('sess-1');
      service.onBuyFill(
        makeSession(),
        { action: 'BUY', coinId: 'BTC', symbol: 'BTC/USD', reason: 'x' },
        { executedPrice: 0, filledQuantity: 1 } as any,
        {}
      );
      expect(tracker.onBuy).not.toHaveBeenCalled();
    });
  });

  describe('onSellFill', () => {
    it('is a no-op when no tracker exists', () => {
      expect(() =>
        service.onSellFill(
          makeSession({ exitConfig: undefined }),
          { action: 'SELL', coinId: 'BTC', symbol: 'BTC/USD', reason: 'x' },
          { filledQuantity: 1 } as any
        )
      ).not.toThrow();
    });

    it('forwards the sell to tracker.onSell', () => {
      const tracker = installFakeTracker('sess-1');
      service.onSellFill(makeSession(), { action: 'SELL', coinId: 'BTC', symbol: 'BTC/USD', reason: 'x' }, {
        filledQuantity: 3
      } as any);
      expect(tracker.onSell).toHaveBeenCalledWith('BTC', 3);
    });
  });

  describe('checkAndExecute', () => {
    const exitFixture = {
      coinId: 'BTC',
      quantity: 1,
      reason: 'stop-loss hit',
      metadata: {},
      executionPrice: 90,
      exitType: 'STOP_LOSS' as const
    };

    it('returns 0 when no tracker exists for the session', async () => {
      const result = await service.checkAndExecute(
        makeSession({ exitConfig: undefined }),
        {},
        {},
        'USD',
        'binance_us',
        new Date()
      );
      expect(result).toBe(0);
      expect(orderExecutor.execute).not.toHaveBeenCalled();
    });

    it('returns 0 when tracker has no registered positions', async () => {
      const session = makeSession();
      service.getOrCreate(session);
      const result = await service.checkAndExecute(session, { 'BTC/USD': 100 }, {}, 'USD', 'binance_us', new Date());
      expect(result).toBe(0);
      expect(orderExecutor.execute).not.toHaveBeenCalled();
    });

    it('executes an exit order, refreshes portfolio, and removes the position on success', async () => {
      const session = makeSession();
      const tracker = installFakeTracker(session.id, [exitFixture]);
      orderExecutor.execute.mockResolvedValue({
        status: 'success',
        order: { executedPrice: 90, filledQuantity: 1 }
      });

      const result = await service.checkAndExecute(session, { 'BTC/USD': 90 }, {}, 'USD', 'binance_us', new Date());

      expect(result).toBe(1);
      expect(orderExecutor.execute).toHaveBeenCalledTimes(1);
      // Refresh called once before the exit loop; not re-called inside the loop.
      expect(portfolioService.refresh).toHaveBeenCalledTimes(1);
      expect(tracker.removePosition).toHaveBeenCalledWith('BTC');
      const processedSignal = signalService.markProcessed.mock.calls[0][0];
      expect(processedSignal.status).toBe(PaperTradingSignalStatus.SIMULATED);
    });

    it('uses candle high/low combined with current price when building price bands', async () => {
      const session = makeSession();
      const tracker = installFakeTracker(session.id, []);
      const candles = [{ high: 120, low: 80, avg: 100, date: new Date() }];

      await service.checkAndExecute(
        session,
        { 'BTC/USD': 100 },
        { 'BTC/USD': candles as any },
        'USD',
        'binance_us',
        new Date()
      );

      const [closeMap, lowMap, highMap] = tracker.checkExits.mock.calls[0];
      expect(closeMap.get('BTC')).toBe(100);
      expect(lowMap.get('BTC')).toBe(80);
      expect(highMap.get('BTC')).toBe(120);
    });

    it('cleans up the tracker and marks signal SIMULATED on no_position result', async () => {
      const session = makeSession();
      const tracker = installFakeTracker(session.id, [exitFixture]);
      orderExecutor.execute.mockResolvedValue({ status: 'no_position', order: null });

      const result = await service.checkAndExecute(session, { 'BTC/USD': 90 }, {}, 'USD', 'binance_us', new Date());

      expect(result).toBe(0);
      expect(tracker.removePosition).toHaveBeenCalledWith('BTC');
      expect(signalService.markProcessed.mock.calls[0][0].status).toBe(PaperTradingSignalStatus.SIMULATED);
    });

    it.each([
      ['no_price', SignalReasonCode.SYMBOL_RESOLUTION_FAILED],
      ['insufficient_funds', SignalReasonCode.INSUFFICIENT_FUNDS],
      ['hold_period', SignalReasonCode.TRADE_COOLDOWN]
    ])('marks signal REJECTED with correct code on %s', async (status, expectedCode) => {
      const session = makeSession();
      const tracker = installFakeTracker(session.id, [exitFixture]);
      orderExecutor.execute.mockResolvedValue({ status, order: null });

      const result = await service.checkAndExecute(session, { 'BTC/USD': 90 }, {}, 'USD', 'binance_us', new Date());

      expect(result).toBe(0);
      expect(tracker.removePosition).not.toHaveBeenCalled();
      const processed = signalService.markProcessed.mock.calls[0][0];
      expect(processed.status).toBe(PaperTradingSignalStatus.REJECTED);
      expect(processed.rejectionCode).toBe(expectedCode);
    });

    it('marks signal ERROR and continues when order executor throws', async () => {
      const session = makeSession();
      installFakeTracker(session.id, [exitFixture]);
      orderExecutor.execute.mockRejectedValue(new Error('boom'));

      const result = await service.checkAndExecute(session, { 'BTC/USD': 90 }, {}, 'USD', 'binance_us', new Date());

      expect(result).toBe(0);
      expect(signalService.markProcessed.mock.calls[0][0].status).toBe(PaperTradingSignalStatus.ERROR);
    });
  });
});
