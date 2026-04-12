import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import {
  PaperTradingAccount,
  PaperTradingOrder,
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSnapshot
} from './entities';
import { PaperTradingJobService } from './paper-trading-job.service';
import { PaperTradingQueryService } from './paper-trading-query.service';

import type { User } from '../../users/users.entity';

describe('PaperTradingQueryService', () => {
  let service: PaperTradingQueryService;
  let sessionRepository: any;
  let accountRepository: any;
  let orderRepository: any;
  let signalRepository: any;
  let snapshotRepository: any;
  let jobService: any;

  const mockUser = { id: 'user-1' } as User;

  const createQueryBuilderMock = (result: unknown[] = []) => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result)
  });

  beforeEach(async () => {
    sessionRepository = {
      findOne: jest.fn(),
      findAndCount: jest.fn()
    };

    accountRepository = {
      find: jest.fn()
    };

    orderRepository = {
      findAndCount: jest.fn()
    };

    signalRepository = {
      findAndCount: jest.fn()
    };

    snapshotRepository = {
      createQueryBuilder: jest.fn()
    };

    jobService = {
      calculateMetrics: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingQueryService,
        { provide: getRepositoryToken(PaperTradingSession), useValue: sessionRepository },
        { provide: getRepositoryToken(PaperTradingAccount), useValue: accountRepository },
        { provide: getRepositoryToken(PaperTradingOrder), useValue: orderRepository },
        { provide: getRepositoryToken(PaperTradingSignal), useValue: signalRepository },
        { provide: getRepositoryToken(PaperTradingSnapshot), useValue: snapshotRepository },
        { provide: PaperTradingJobService, useValue: jobService }
      ]
    }).compile();

    service = module.get<PaperTradingQueryService>(PaperTradingQueryService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findOne', () => {
    it('returns the session scoped to the requesting user', async () => {
      const session = { id: 'session-1', user: mockUser } as any;
      sessionRepository.findOne.mockResolvedValue(session);

      const result = await service.findOne('session-1', mockUser);

      expect(sessionRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'session-1', user: { id: mockUser.id } },
        relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange', 'accounts']
      });
      expect(result).toBe(session);
    });

    it('throws NotFoundException when the session is missing', async () => {
      sessionRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing', mockUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('applies optional filters and pagination', async () => {
      sessionRepository.findAndCount.mockResolvedValue([[{ id: 'session-1' }], 1]);

      const result = await service.findAll(mockUser, {
        status: 'RUNNING',
        algorithmId: 'algo-1',
        pipelineId: 'pipeline-1',
        limit: 25,
        offset: 10
      } as any);

      expect(sessionRepository.findAndCount).toHaveBeenCalledWith({
        where: {
          user: { id: mockUser.id },
          status: 'RUNNING',
          algorithm: { id: 'algo-1' },
          pipelineId: 'pipeline-1'
        },
        relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange'],
        order: { createdAt: 'DESC' },
        take: 25,
        skip: 10
      });
      expect(result).toEqual({ data: [{ id: 'session-1' }], total: 1 });
    });

    it('falls back to default pagination when filters are empty', async () => {
      sessionRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(mockUser, {} as any);

      const [options] = sessionRepository.findAndCount.mock.calls[0];
      expect(options.where).toEqual({ user: { id: mockUser.id } });
      expect(options.take).toBe(50);
      expect(options.skip).toBe(0);
    });
  });

  describe('getOrders', () => {
    it('propagates NotFoundException from the access check and skips the order query', async () => {
      jest.spyOn(service, 'findOne').mockRejectedValue(new NotFoundException());

      await expect(service.getOrders('session-1', mockUser, {} as any)).rejects.toThrow(NotFoundException);
      expect(orderRepository.findAndCount).not.toHaveBeenCalled();
    });

    it('forwards status, side, and symbol filters to the repository', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);
      orderRepository.findAndCount.mockResolvedValue([[{ id: 'order-1' }], 1]);

      const result = await service.getOrders('session-1', mockUser, {
        status: 'FILLED',
        side: 'BUY',
        symbol: 'BTC/USD'
      } as any);

      expect(orderRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            session: { id: 'session-1' },
            status: 'FILLED',
            side: 'BUY',
            symbol: 'BTC/USD'
          },
          relations: ['signal'],
          take: 100,
          skip: 0
        })
      );
      expect(result).toEqual({ data: [{ id: 'order-1' }], total: 1 });
    });
  });

  describe('getSignals', () => {
    it('includes processed=false in the where clause (regression: falsy guard)', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);
      signalRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.getSignals('session-1', mockUser, { processed: false } as any);

      expect(signalRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { session: { id: 'session-1' }, processed: false }
        })
      );
    });
  });

  describe('getSnapshots', () => {
    it('wires after/before conditions and the caller-supplied limit onto the query builder', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);
      const qb = createQueryBuilderMock([{ id: 'snap-1' }]);
      snapshotRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getSnapshots('session-1', mockUser, {
        after: '2026-01-01T00:00:00Z',
        before: '2026-02-01T00:00:00Z',
        limit: 50
      } as any);

      expect(qb.where).toHaveBeenCalledWith('snapshot.sessionId = :sessionId', { sessionId: 'session-1' });
      expect(qb.orderBy).toHaveBeenCalledWith('snapshot.timestamp', 'ASC');
      expect(qb.take).toHaveBeenCalledWith(50);
      expect(qb.andWhere).toHaveBeenCalledWith('snapshot.timestamp > :after', {
        after: new Date('2026-01-01T00:00:00Z')
      });
      expect(qb.andWhere).toHaveBeenCalledWith('snapshot.timestamp < :before', {
        before: new Date('2026-02-01T00:00:00Z')
      });
      expect(result).toEqual([{ id: 'snap-1' }]);
    });

    it('uses the default limit of 200 and omits andWhere when no date bounds are given', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);
      const qb = createQueryBuilderMock();
      snapshotRepository.createQueryBuilder.mockReturnValue(qb);

      await service.getSnapshots('session-1', mockUser, {} as any);

      expect(qb.take).toHaveBeenCalledWith(200);
      expect(qb.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('getPositions', () => {
    it('excludes the quote currency and zero-balance holdings', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);
      accountRepository.find.mockResolvedValue([
        { currency: 'USD', total: 50000, averageCost: 0 },
        { currency: 'BTC', total: 0.5, averageCost: 30000 },
        { currency: 'ETH', total: 0, averageCost: 2000 }
      ]);

      const positions = await service.getPositions('session-1', mockUser);

      expect(positions).toEqual([{ symbol: 'BTC/USD', quantity: 0.5, averageCost: 30000 }]);
    });

    it('defaults averageCost to 0 when the account value is null', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);
      accountRepository.find.mockResolvedValue([
        { currency: 'USD', total: 1000, averageCost: 0 },
        { currency: 'BTC', total: 0.1, averageCost: null }
      ]);

      const positions = await service.getPositions('session-1', mockUser);

      expect(positions).toEqual([{ symbol: 'BTC/USD', quantity: 0.1, averageCost: 0 }]);
    });
  });

  describe('getPerformance', () => {
    it('fetches the session and delegates to jobService.calculateMetrics', async () => {
      const session = { id: 'session-10', user: mockUser } as any;
      const metrics = { totalReturn: 2000, totalReturnPercent: 20 } as any;

      const findOneSpy = jest.spyOn(service, 'findOne').mockResolvedValue(session);
      jobService.calculateMetrics.mockResolvedValue(metrics);

      const result = await service.getPerformance('session-10', mockUser);

      expect(findOneSpy).toHaveBeenCalledWith('session-10', mockUser);
      expect(jobService.calculateMetrics).toHaveBeenCalledWith(session);
      expect(result).toBe(metrics);
    });
  });
});
