import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DailyLossLimitGateService } from './daily-loss-limit-gate.service';

import { Order } from '../order/order.entity';

describe('DailyLossLimitGateService', () => {
  let service: DailyLossLimitGateService;
  let mockQueryBuilder: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalLoss: '0' })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyLossLimitGateService,
        {
          provide: getRepositoryToken(Order),
          useValue: {
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
          }
        }
      ]
    }).compile();

    service = module.get<DailyLossLimitGateService>(DailyLossLimitGateService);
  });

  describe('exit actions always pass through', () => {
    it.each(['sell', 'short_exit'] as const)('%s bypasses gate without querying DB', async (action) => {
      const result = await service.checkDailyLossLimit('user-1', 1000, 3, action);
      expect(result.allowed).toBe(true);
      expect(mockQueryBuilder.getRawOne).not.toHaveBeenCalled();
    });
  });

  describe('zero / negative capital guard', () => {
    it.each([0, -100])('blocks BUY when capital is %d', async (capital) => {
      const result = await service.checkDailyLossLimit('user-1', capital, 3, 'buy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('zero or negative');
    });
  });

  describe('threshold breach', () => {
    it('blocks BUY when losses exceed threshold', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: '-150' });

      const result = await service.checkDailyLossLimit('user-1', 1000, 3, 'buy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('15.0% losses');
      expect(result.reason).toContain('10.0% limit');
    });

    it('blocks BUY at exact threshold boundary (>=)', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: '-100' });

      const result = await service.checkDailyLossLimit('user-1', 1000, 3, 'buy');
      expect(result.allowed).toBe(false);
    });

    it('blocks short_entry the same as buy', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: '-200' });

      const result = await service.checkDailyLossLimit('user-1', 1000, 3, 'short_entry');
      expect(result.allowed).toBe(false);
    });

    it('allows BUY when losses are below threshold', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: '-50' });

      const result = await service.checkDailyLossLimit('user-1', 1000, 3, 'buy');
      expect(result.allowed).toBe(true);
    });
  });

  describe('risk level threshold mapping', () => {
    it.each([
      [1, 5],
      [2, 7.5],
      [3, 10],
      [4, 12.5],
      [5, 15]
    ])('risk level %d uses %d%% threshold', async (riskLevel, threshold) => {
      const capital = 1000;
      const lossAmount = capital * (threshold / 100);
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: String(-lossAmount) });

      const result = await service.checkDailyLossLimit('user-1', capital, riskLevel, 'buy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(`${threshold.toFixed(1)}% limit`);
    });

    it('falls back to risk level 3 (10%) for unknown levels', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: '-100' });

      const result = await service.checkDailyLossLimit('user-1', 1000, 99, 'buy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('10.0% limit');
    });
  });

  describe('fail-closed on query error', () => {
    it('blocks BUY when DB query throws', async () => {
      mockQueryBuilder.getRawOne.mockRejectedValue(new Error('DB connection lost'));

      const result = await service.checkDailyLossLimit('user-1', 1000, 3, 'buy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('fail-closed');
    });
  });

  describe('isEntryBlocked convenience method', () => {
    it('returns blocked: true when losses exceed threshold', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: '-200' });

      const result = await service.isEntryBlocked('user-1', 1000, 3);
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('Daily loss limit exceeded');
    });

    it('returns blocked: false when losses are under threshold', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ totalLoss: '-50' });

      const result = await service.isEntryBlocked('user-1', 1000, 3);
      expect(result.blocked).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('edge case: null query result', () => {
    it('allows BUY when getRawOne returns null', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue(null);

      const result = await service.checkDailyLossLimit('user-1', 1000, 3, 'buy');
      expect(result.allowed).toBe(true);
    });
  });
});
