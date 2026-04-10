import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PaperTradingSnapshotService } from './paper-trading-snapshot.service';

import { MetricsCalculatorService, type Portfolio, TimeframeType } from '../../backtest/shared';
import { PaperTradingOrder, PaperTradingOrderSide, type PaperTradingSession, PaperTradingSnapshot } from '../entities';

describe('PaperTradingSnapshotService', () => {
  let service: PaperTradingSnapshotService;
  let snapshotRepo: { create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let orderRepo: { find: jest.Mock; createQueryBuilder: jest.Mock };
  let metricsCalculator: { calculateSharpeRatio: jest.Mock };

  const buildSession = (overrides: Partial<PaperTradingSession> = {}): PaperTradingSession =>
    ({
      id: 'session-1',
      initialCapital: 10_000,
      peakPortfolioValue: 10_000,
      ...overrides
    }) as PaperTradingSession;

  const buildPortfolio = (): Portfolio =>
    ({
      cashBalance: 5_000,
      positions: new Map([
        [
          'BTC',
          {
            quantity: 0.1,
            averagePrice: 40_000
          } as unknown as Portfolio['positions'] extends Map<string, infer V> ? V : never
        ]
      ])
    }) as unknown as Portfolio;

  beforeEach(async () => {
    snapshotRepo = {
      create: jest.fn((x) => x),
      save: jest.fn((x) => Promise.resolve({ ...x, id: 'snap-1' })),
      find: jest.fn()
    };
    orderRepo = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ totalRealizedPnL: 123 })
      }))
    };
    metricsCalculator = { calculateSharpeRatio: jest.fn().mockReturnValue(1.5) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingSnapshotService,
        { provide: getRepositoryToken(PaperTradingSnapshot), useValue: snapshotRepo },
        { provide: getRepositoryToken(PaperTradingOrder), useValue: orderRepo },
        { provide: MetricsCalculatorService, useValue: metricsCalculator }
      ]
    }).compile();

    service = module.get(PaperTradingSnapshotService);
  });

  describe('save', () => {
    it('creates and persists a snapshot with holdings, pnl, and drawdown', async () => {
      const session = buildSession({ peakPortfolioValue: 11_000 });
      const portfolio = buildPortfolio();
      const prices = { 'BTC/USD': 45_000 };

      const result = await service.save(session, portfolio, 9_500, prices, 'USD', new Date('2024-01-01'));

      expect(snapshotRepo.create).toHaveBeenCalledTimes(1);
      const created = snapshotRepo.create.mock.calls[0][0];
      expect(created.portfolioValue).toBe(9_500);
      expect(created.cashBalance).toBe(5_000);
      expect(created.holdings.BTC.quantity).toBe(0.1);
      expect(created.holdings.BTC.price).toBe(45_000);
      // unrealized = (45000 - 40000) * 0.1 = 500
      expect(created.holdings.BTC.unrealizedPnL).toBe(500);
      expect(created.unrealizedPnL).toBe(500);
      // cumulativeReturn = (9500 - 10000) / 10000 = -0.05
      expect(created.cumulativeReturn).toBeCloseTo(-0.05);
      // peak = max(11000, 9500) = 11000; drawdown = (11000-9500)/11000
      expect(created.drawdown).toBeCloseTo(1500 / 11000);
      expect(created.realizedPnL).toBe(123);
      expect(result.id).toBe('snap-1');
      expect(snapshotRepo.save).toHaveBeenCalled();
    });

    it('clamps drawdown to 0 when portfolio value exceeds stale peak', async () => {
      const session = buildSession({ peakPortfolioValue: 10_000 });
      await service.save(session, buildPortfolio(), 12_000, { 'BTC/USD': 45_000 }, 'USD', new Date());
      expect(snapshotRepo.create.mock.calls[0][0].drawdown).toBe(0);
    });

    it('falls back to initialCapital when peakPortfolioValue is null', async () => {
      const session = buildSession({ peakPortfolioValue: null as unknown as number });
      await service.save(session, buildPortfolio(), 9_000, { 'BTC/USD': 45_000 }, 'USD', new Date());
      // peak = max(10000, 9000) = 10000; dd = 1000/10000 = 0.1
      expect(snapshotRepo.create.mock.calls[0][0].drawdown).toBeCloseTo(0.1);
    });

    it('treats averagePrice=0 positions as zero unrealized P&L', async () => {
      const portfolio = {
        cashBalance: 1_000,
        positions: new Map([['BTC', { quantity: 0.1, averagePrice: 0 }]])
      } as unknown as Portfolio;
      await service.save(buildSession(), portfolio, 10_000, { 'BTC/USD': 45_000 }, 'USD', new Date());
      const created = snapshotRepo.create.mock.calls[0][0];
      expect(created.holdings.BTC.unrealizedPnL).toBe(0);
      expect(created.holdings.BTC.unrealizedPnLPercent).toBe(0);
      expect(created.unrealizedPnL).toBe(0);
    });

    it('falls back to price 0 when symbol missing from prices map', async () => {
      await service.save(buildSession(), buildPortfolio(), 5_000, {}, 'USD', new Date());
      const created = snapshotRepo.create.mock.calls[0][0];
      expect(created.holdings.BTC.price).toBe(0);
      expect(created.holdings.BTC.value).toBe(0);
    });

    it('defaults realizedPnL to 0 when query returns no rows', async () => {
      orderRepo.createQueryBuilder.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(undefined)
      });
      await service.save(buildSession(), buildPortfolio(), 10_000, { 'BTC/USD': 45_000 }, 'USD', new Date());
      expect(snapshotRepo.create.mock.calls[0][0].realizedPnL).toBe(0);
    });
  });

  describe('calculateSessionMetrics', () => {
    it('computes win rate, trade counts, sharpe, and max drawdown', async () => {
      const session = buildSession();
      orderRepo.find.mockResolvedValue([
        { side: PaperTradingOrderSide.BUY, realizedPnL: null },
        { side: PaperTradingOrderSide.SELL, realizedPnL: 100 },
        { side: PaperTradingOrderSide.SELL, realizedPnL: -50 },
        { side: PaperTradingOrderSide.SELL, realizedPnL: 25 }
      ]);
      snapshotRepo.find.mockResolvedValue([
        { portfolioValue: 10_000 },
        { portfolioValue: 10_500 },
        { portfolioValue: 10_200 },
        { portfolioValue: 11_000 },
        { portfolioValue: 9_900 }
      ]);

      const result = await service.calculateSessionMetrics(session);

      expect(result.totalTrades).toBe(4);
      expect(result.winningTrades).toBe(2);
      expect(result.losingTrades).toBe(1);
      expect(result.winRate).toBeCloseTo(2 / 3);
      expect(metricsCalculator.calculateSharpeRatio).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ timeframe: TimeframeType.HOURLY, useCryptoCalendar: true, riskFreeRate: 0.02 })
      );
      expect(result.sharpeRatio).toBe(1.5);
      // peak = 11000, min after = 9900, dd = 1100/11000 = 0.1
      expect(result.maxDrawdown).toBeCloseTo(0.1);
    });

    it('returns sharpe 0 when insufficient return samples', async () => {
      const session = buildSession();
      orderRepo.find.mockResolvedValue([]);
      snapshotRepo.find.mockResolvedValue([{ portfolioValue: 10_000 }, { portfolioValue: 10_100 }]);

      const result = await service.calculateSessionMetrics(session);

      expect(result.sharpeRatio).toBe(0);
      expect(metricsCalculator.calculateSharpeRatio).not.toHaveBeenCalled();
      expect(result.winRate).toBe(0);
      expect(result.totalTrades).toBe(0);
    });
  });
});
