import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { SignalSource } from '@chansey/api-interfaces';

import { SignalActivityFeedService } from './signal-activity-feed.service';

import { Coin } from '../../coin/coin.entity';
import { BacktestSignal, SignalDirection, SignalType } from '../../order/backtest/backtest-signal.entity';
import { Backtest } from '../../order/backtest/backtest.entity';
import { PaperTradingSession } from '../../order/paper-trading/entities/paper-trading-session.entity';
import { PaperTradingSignal } from '../../order/paper-trading/entities/paper-trading-signal.entity';
import { LiveTradingSignal } from '../../strategy/entities/live-trading-signal.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

const createMockQueryBuilder = () => {
  const qb: Partial<SelectQueryBuilder<any>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    setParameter: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({ maxTs: null, hourCount: '0', dayCount: '0' }),
    getMany: jest.fn().mockResolvedValue([])
  };
  return qb as SelectQueryBuilder<any>;
};

const createSignal = (overrides: Partial<BacktestSignal> = {}): BacktestSignal =>
  ({
    id: 'signal-1',
    timestamp: new Date(),
    signalType: SignalType.ENTRY,
    instrument: 'BTC/USDT',
    direction: SignalDirection.LONG,
    quantity: 1,
    price: 50000,
    reason: 'Test',
    confidence: 0.75,
    ...overrides
  }) as BacktestSignal;

describe('SignalActivityFeedService', () => {
  let service: SignalActivityFeedService;
  let backtestRepo: MockRepo<Backtest>;
  let signalRepo: MockRepo<BacktestSignal>;
  let paperSessionRepo: MockRepo<PaperTradingSession>;
  let paperSignalRepo: MockRepo<PaperTradingSignal>;
  let liveSignalRepo: MockRepo<LiveTradingSignal>;
  let coinRepo: MockRepo<Coin>;
  let mockQueryBuilder: SelectQueryBuilder<any>;

  beforeEach(async () => {
    mockQueryBuilder = createMockQueryBuilder();

    backtestRepo = { count: jest.fn().mockResolvedValue(0) };
    signalRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    paperSessionRepo = { count: jest.fn().mockResolvedValue(0) };
    paperSignalRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    liveSignalRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };
    coinRepo = { createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalActivityFeedService,
        { provide: getRepositoryToken(Backtest), useValue: backtestRepo },
        { provide: getRepositoryToken(BacktestSignal), useValue: signalRepo },
        { provide: getRepositoryToken(PaperTradingSession), useValue: paperSessionRepo },
        { provide: getRepositoryToken(PaperTradingSignal), useValue: paperSignalRepo },
        { provide: getRepositoryToken(LiveTradingSignal), useValue: liveSignalRepo },
        { provide: getRepositoryToken(Coin), useValue: coinRepo }
      ]
    }).compile();

    service = module.get(SignalActivityFeedService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getSignalActivityFeed', () => {
    it('clamps oversized limit to the configured maximum', async () => {
      await service.getSignalActivityFeed(10_000);
      // All three signal query builders use .take(); the clamped value should be 500.
      const takeCalls = (mockQueryBuilder.take as jest.Mock).mock.calls.map((c) => c[0]);
      expect(takeCalls).toEqual(expect.arrayContaining([500]));
      expect(takeCalls.every((v) => v <= 500)).toBe(true);
    });

    it('returns combined feed with health summary when no signals exist', async () => {
      const result = await service.getSignalActivityFeed(100);

      expect(result).toMatchObject({
        signals: [],
        health: {
          signalsLastHour: 0,
          signalsLast24h: 0,
          totalActiveSources: 0,
          activeBacktestSources: 0,
          activePaperTradingSources: 0
        }
      });
      expect(result.health.lastSignalTime).toBeUndefined();
      expect(result.health.lastSignalAgoMs).toBeUndefined();
    });

    it('merges and sorts signals from all sources by timestamp DESC', async () => {
      const now = new Date();
      const twoMinAgo = new Date(now.getTime() - 2 * 60 * 1000);
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      const tenMinAgo = new Date(now.getTime() - 10 * 60 * 1000);

      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([
        createSignal({
          id: 'bs-1',
          timestamp: tenMinAgo,
          backtest: {
            id: 'bt-1',
            name: 'Test BT',
            algorithm: { name: 'Algo1' },
            user: { email: 'user@test.com' }
          } as any
        })
      ]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'ps-1',
          createdAt: fiveMinAgo,
          signalType: SignalType.EXIT,
          direction: SignalDirection.LONG,
          instrument: 'ETH/USDT',
          quantity: 2,
          price: 3000,
          confidence: 0.8,
          reason: 'Take profit',
          processed: true,
          status: 'SIMULATED',
          rejectionCode: null,
          session: {
            id: 'sess-1',
            name: 'Test Session',
            algorithm: { name: 'Algo2' },
            user: { email: 'user2@test.com' }
          }
        }
      ]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'ls-1',
          createdAt: twoMinAgo,
          action: 'buy',
          symbol: 'SOL/USDT',
          quantity: 10,
          price: 150,
          confidence: 0.9,
          status: 'PLACED',
          reasonCode: null,
          reason: 'Strong momentum',
          strategyConfigId: 'sc-1',
          algorithmActivationId: null,
          user: { email: 'user3@test.com' },
          strategyConfig: { id: 'sc-1', name: 'Momentum', algorithm: { name: 'Algo3' } },
          algorithmActivation: null
        }
      ]);

      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: tenMinAgo.toISOString(),
        hourCount: '1',
        dayCount: '1'
      });
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: fiveMinAgo.toISOString(),
        hourCount: '1',
        dayCount: '1'
      });
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: twoMinAgo.toISOString(),
        hourCount: '1',
        dayCount: '1'
      });
      (backtestRepo.count as jest.Mock).mockResolvedValueOnce(1);

      const result = await service.getSignalActivityFeed(10);

      expect(result.signals).toHaveLength(3);
      expect(result.signals[0].id).toBe('ls-1');
      expect(result.signals[0].source).toBe('LIVE_TRADING');
      expect(result.signals[0].signalType).toBe(SignalType.ENTRY);
      expect(result.signals[0].direction).toBe(SignalDirection.LONG);
      expect(result.signals[1].id).toBe('ps-1');
      expect(result.signals[1].source).toBe('PAPER_TRADING');
      expect(result.signals[2].id).toBe('bs-1');
      expect(result.signals[2].source).toBe('BACKTEST');
    });

    it('slices merged results from all sources down to limit', async () => {
      const now = Date.now();
      const backtest = { id: 'bt-1', name: 'BT', algorithm: { name: 'Algo' }, user: { email: 'u@t.com' } } as any;
      const bsSignals = Array.from({ length: 3 }, (_, i) =>
        createSignal({ id: `bs-${i}`, timestamp: new Date(now - (i + 10) * 1000), backtest })
      );
      const psSignals = Array.from({ length: 3 }, (_, i) => ({
        id: `ps-${i}`,
        createdAt: new Date(now - (i + 20) * 1000),
        signalType: SignalType.ENTRY,
        direction: SignalDirection.LONG,
        instrument: 'ETH/USDT',
        quantity: 1,
        price: 100,
        confidence: 0.5,
        reason: 'r',
        processed: true,
        status: 'SIMULATED',
        rejectionCode: null,
        session: { id: 's', name: 'S', algorithm: { name: 'A' }, user: { email: 'u@t.com' } }
      }));

      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce(bsSignals);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce(psSignals);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getSignalActivityFeed(4);

      // Post-merge slice: 6 total signals trimmed to 4
      expect(result.signals).toHaveLength(4);
      // Sorted DESC: the 4 newest are the 3 backtest signals + newest paper signal
      expect(result.signals.map((s) => s.id)).toEqual(['bs-0', 'bs-1', 'bs-2', 'ps-0']);
    });

    it('falls back to PROCESSED/PENDING for paper signals without explicit status', async () => {
      const now = new Date();
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'ps-processed',
          createdAt: now,
          signalType: SignalType.ENTRY,
          direction: SignalDirection.LONG,
          instrument: 'BTC/USDT',
          quantity: 1,
          price: 100,
          confidence: 0.5,
          reason: 'r',
          processed: true,
          status: null,
          rejectionCode: null,
          session: { id: 's', name: 'S', algorithm: { name: 'A' }, user: { email: 'u@t.com' } }
        },
        {
          id: 'ps-pending',
          createdAt: new Date(now.getTime() - 1000),
          signalType: SignalType.ENTRY,
          direction: SignalDirection.LONG,
          instrument: 'BTC/USDT',
          quantity: 1,
          price: 100,
          confidence: 0.5,
          reason: 'r',
          processed: false,
          status: null,
          rejectionCode: null,
          session: { id: 's', name: 'S', algorithm: { name: 'A' }, user: { email: 'u@t.com' } }
        }
      ]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);

      const result = await service.getSignalActivityFeed(10);

      expect(result.signals.find((s) => s.id === 'ps-processed')?.status).toBe('PROCESSED');
      expect(result.signals.find((s) => s.id === 'ps-pending')?.status).toBe('PENDING');
    });
  });

  describe('getSignalHealth', () => {
    it('returns combined counts from all three signal tables', async () => {
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      const recentTime = new Date(Date.now() - 60000).toISOString();

      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: recentTime,
        hourCount: '5',
        dayCount: '20'
      });
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: null,
        hourCount: '3',
        dayCount: '10'
      });
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: null,
        hourCount: '2',
        dayCount: '5'
      });
      (backtestRepo.count as jest.Mock).mockResolvedValueOnce(2);

      const result = await service.getSignalActivityFeed(100);

      expect(result.health.signalsLastHour).toBe(10);
      expect(result.health.signalsLast24h).toBe(35);
      expect(result.health.lastSignalTime).toBe(recentTime);
      expect(result.health.lastSignalAgoMs).toBeGreaterThan(0);
      expect(result.health.activeBacktestSources).toBe(2);
    });

    it('preserves partial NaN values instead of zeroing entire sum', async () => {
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValue([]);

      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: null,
        hourCount: '7',
        dayCount: '20'
      });
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: null,
        hourCount: null,
        dayCount: null
      });
      (mockQueryBuilder.getRawOne as jest.Mock).mockResolvedValueOnce({
        maxTs: null,
        hourCount: '3',
        dayCount: '5'
      });

      const result = await service.getSignalActivityFeed(100);

      expect(result.health.signalsLastHour).toBe(10);
      expect(result.health.signalsLast24h).toBe(25);
    });
  });

  describe('live signal mapping', () => {
    it('maps buy action to ENTRY/LONG and sell action to EXIT/LONG', async () => {
      const now = new Date();
      const oneMinAgo = new Date(now.getTime() - 60000);
      const twoMinAgo = new Date(now.getTime() - 120000);

      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'ls-buy',
          createdAt: oneMinAgo,
          action: 'buy',
          symbol: 'BTC/USDT',
          quantity: 1,
          price: 60000,
          confidence: 0.85,
          status: 'PLACED',
          reasonCode: null,
          reason: 'Bullish signal',
          strategyConfigId: 'sc-1',
          algorithmActivationId: null,
          user: { email: 'u@t.com' },
          strategyConfig: { id: 'sc-1', name: 'Strat', algorithm: { name: 'Algo' } },
          algorithmActivation: null
        },
        {
          id: 'ls-sell',
          createdAt: twoMinAgo,
          action: 'sell',
          symbol: 'BTC/USDT',
          quantity: 1,
          price: 61000,
          confidence: 0.7,
          status: 'PLACED',
          reasonCode: null,
          reason: 'Take profit',
          strategyConfigId: 'sc-1',
          algorithmActivationId: null,
          user: { email: 'u@t.com' },
          strategyConfig: { id: 'sc-1', name: 'Strat', algorithm: { name: 'Algo' } },
          algorithmActivation: null
        }
      ]);

      const result = await service.getSignalActivityFeed(10);

      const buySignal = result.signals.find((s) => s.id === 'ls-buy');
      const sellSignal = result.signals.find((s) => s.id === 'ls-sell');

      expect(buySignal).toMatchObject({
        signalType: SignalType.ENTRY,
        direction: SignalDirection.LONG,
        source: SignalSource.LIVE_TRADING,
        instrument: 'BTC/USDT'
      });
      expect(sellSignal).toMatchObject({
        signalType: SignalType.EXIT,
        direction: SignalDirection.LONG
      });
    });

    it('maps short_entry to ENTRY/SHORT and short_exit to EXIT/SHORT', async () => {
      const now = new Date();

      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([]);
      (mockQueryBuilder.getMany as jest.Mock).mockResolvedValueOnce([
        {
          id: 'ls-short-entry',
          createdAt: now,
          action: 'short_entry',
          symbol: 'ETH/USDT',
          quantity: 5,
          price: 3000,
          confidence: 0.6,
          status: 'PLACED',
          reasonCode: null,
          reason: 'Bearish',
          strategyConfigId: null,
          algorithmActivationId: 'aa-1',
          user: { email: 'u@t.com' },
          strategyConfig: null,
          algorithmActivation: { id: 'aa-1', algorithm: { name: 'ShortAlgo' } }
        },
        {
          id: 'ls-short-exit',
          createdAt: new Date(now.getTime() - 1000),
          action: 'short_exit',
          symbol: 'ETH/USDT',
          quantity: 5,
          price: 2900,
          confidence: 0.7,
          status: 'PLACED',
          reasonCode: null,
          reason: 'Cover',
          strategyConfigId: null,
          algorithmActivationId: 'aa-1',
          user: { email: 'u@t.com' },
          strategyConfig: null,
          algorithmActivation: { id: 'aa-1', algorithm: { name: 'ShortAlgo' } }
        }
      ]);

      const result = await service.getSignalActivityFeed(10);

      const entry = result.signals.find((s) => s.id === 'ls-short-entry');
      const exit = result.signals.find((s) => s.id === 'ls-short-exit');

      expect(entry).toMatchObject({
        signalType: SignalType.ENTRY,
        direction: SignalDirection.SHORT,
        algorithmName: 'ShortAlgo'
      });
      expect(exit).toMatchObject({
        signalType: SignalType.EXIT,
        direction: SignalDirection.SHORT
      });
    });
  });
});
