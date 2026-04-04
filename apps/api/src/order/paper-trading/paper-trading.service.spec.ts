import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DataSource } from 'typeorm';

import {
  PaperTradingAccount,
  PaperTradingOrder,
  PaperTradingSession,
  PaperTradingSignal,
  PaperTradingSnapshot,
  PaperTradingStatus
} from './entities';
import { PaperTradingJobService } from './paper-trading-job.service';
import { PaperTradingJobType } from './paper-trading.job-data';
import { PaperTradingService } from './paper-trading.service';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import type { User } from '../../users/users.entity';

describe('PaperTradingService', () => {
  let service: PaperTradingService;
  let sessionRepository: any;
  let accountRepository: any;
  let orderRepository: any;
  let algorithmRepository: any;
  let exchangeKeyRepository: any;
  let paperTradingQueue: any;
  let dataSource: any;
  let jobService: any;

  const mockUser = { id: 'user-1' } as User;

  const baseCreateDto = {
    algorithmId: 'algo-1',
    exchangeKeyId: 'key-1',
    initialCapital: 1000
  } as any;

  beforeEach(async () => {
    sessionRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      remove: jest.fn(),
      update: jest.fn()
    };

    accountRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn()
    };

    orderRepository = {
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const signalRepository = { findAndCount: jest.fn() };
    const snapshotRepository = { createQueryBuilder: jest.fn() };

    algorithmRepository = { findOne: jest.fn() };
    exchangeKeyRepository = { findOne: jest.fn() };

    paperTradingQueue = {
      add: jest.fn(),
      getJob: jest.fn().mockResolvedValue(null),
      removeJobScheduler: jest.fn(),
      upsertJobScheduler: jest.fn()
    };

    dataSource = {
      transaction: jest.fn((callback) => callback(sessionRepository))
    };

    jobService = {
      scheduleTickJob: jest.fn().mockResolvedValue(undefined),
      scheduleRetryTick: jest.fn().mockResolvedValue(undefined),
      removeTickJobs: jest.fn().mockResolvedValue(undefined),
      updateSessionMetrics: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      findActiveSessions: jest.fn().mockResolvedValue([]),
      getSessionStatus: jest.fn().mockResolvedValue({}),
      calculateMetrics: jest.fn().mockResolvedValue({
        initialCapital: 10000,
        currentPortfolioValue: 12000,
        totalReturn: 2000,
        totalReturnPercent: 20,
        maxDrawdown: 0,
        sharpeRatio: null,
        winRate: 0,
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        totalFees: 0,
        durationHours: 0
      })
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingService,
        { provide: getRepositoryToken(PaperTradingSession), useValue: sessionRepository },
        { provide: getRepositoryToken(PaperTradingAccount), useValue: accountRepository },
        { provide: getRepositoryToken(PaperTradingOrder), useValue: orderRepository },
        { provide: getRepositoryToken(PaperTradingSignal), useValue: signalRepository },
        { provide: getRepositoryToken(PaperTradingSnapshot), useValue: snapshotRepository },
        { provide: getRepositoryToken(Algorithm), useValue: algorithmRepository },
        { provide: getRepositoryToken(ExchangeKey), useValue: exchangeKeyRepository },
        { provide: getQueueToken('paper-trading'), useValue: paperTradingQueue },
        { provide: DataSource, useValue: dataSource },
        { provide: PaperTradingJobService, useValue: jobService }
      ]
    }).compile();

    service = module.get<PaperTradingService>(PaperTradingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('throws NotFoundException when algorithm does not exist', async () => {
      algorithmRepository.findOne.mockResolvedValue(null);

      await expect(service.create(baseCreateDto, mockUser)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when exchange key does not exist', async () => {
      algorithmRepository.findOne.mockResolvedValue({ id: 'algo-1' });
      exchangeKeyRepository.findOne.mockResolvedValue(null);

      await expect(service.create(baseCreateDto, mockUser)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ForbiddenException when exchange key belongs to another user', async () => {
      algorithmRepository.findOne.mockResolvedValue({ id: 'algo-1' });
      exchangeKeyRepository.findOne.mockResolvedValue({ id: 'key-1', user: { id: 'other' } });

      await expect(service.create(baseCreateDto, mockUser)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates session with quote account using provided currency', async () => {
      algorithmRepository.findOne.mockResolvedValue({ id: 'algo-1' });
      exchangeKeyRepository.findOne.mockResolvedValue({ id: 'key-1', user: { id: mockUser.id }, exchange: {} });

      const createdSession = { id: 'session-1' };
      sessionRepository.create.mockReturnValue(createdSession);
      sessionRepository.save.mockResolvedValue(createdSession);
      accountRepository.create.mockReturnValue({});
      accountRepository.save.mockResolvedValue({});

      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);

      const result = await service.create({ ...baseCreateDto, quoteCurrency: 'USD' } as any, mockUser);

      expect(sessionRepository.save).toHaveBeenCalledWith(createdSession);
      expect(accountRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD', available: 1000, locked: 0 })
      );
      expect(result).toEqual({ id: 'session-1' });
    });
  });

  describe('update', () => {
    it('throws BadRequestException when session is active', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1', status: PaperTradingStatus.ACTIVE } as any);

      await expect(service.update('session-1', { name: 'new' } as any, mockUser)).rejects.toBeInstanceOf(
        BadRequestException
      );
    });

    it('applies dto changes and returns updated session', async () => {
      const session = { id: 'session-1', status: PaperTradingStatus.PAUSED, name: 'old' } as any;
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce({ ...session, name: 'new' });
      sessionRepository.save.mockResolvedValue(session);

      const result = await service.update('session-1', { name: 'new' } as any, mockUser);

      expect(sessionRepository.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'new' }));
      expect(result.name).toBe('new');
    });
  });

  describe('start', () => {
    it('transitions to ACTIVE and enqueues start job', async () => {
      const session = { id: 'session-2', status: PaperTradingStatus.PAUSED } as any;
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce({ id: 'session-2', status: PaperTradingStatus.ACTIVE } as any);

      const result = await service.start('session-2', mockUser);

      expect(session.status).toBe(PaperTradingStatus.ACTIVE);
      expect(session.consecutiveErrors).toBe(0);
      expect(session.retryAttempts).toBe(0);
      expect(paperTradingQueue.add).toHaveBeenCalledWith(
        'start-session',
        { type: PaperTradingJobType.START_SESSION, sessionId: 'session-2', userId: mockUser.id },
        { jobId: 'paper-trading-start-session-2' }
      );
      expect(result.status).toBe(PaperTradingStatus.ACTIVE);
    });

    it('rejects when already active', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.ACTIVE } as any);

      await expect(service.start('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when completed or failed', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.COMPLETED } as any);
      await expect(service.start('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);

      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.FAILED } as any);
      await expect(service.start('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('stop', () => {
    it('stops session, removes tick jobs, and notifies pipeline when pipelineId exists', async () => {
      const session = { id: 'session-5', status: PaperTradingStatus.ACTIVE, pipelineId: 'pipe-1' } as any;
      jest.spyOn(service, 'findOne').mockResolvedValue(session);

      await service.stop('session-5', mockUser, 'user_cancelled');

      expect(session.status).toBe(PaperTradingStatus.STOPPED);
      expect(session.stoppedReason).toBe('user_cancelled');
      expect(jobService.removeTickJobs).toHaveBeenCalledWith('session-5');
      expect(paperTradingQueue.add).toHaveBeenCalledWith(
        'stop-session',
        expect.objectContaining({ type: PaperTradingJobType.STOP_SESSION, sessionId: 'session-5' }),
        expect.objectContaining({ jobId: 'paper-trading-stop-session-5' })
      );
      expect(paperTradingQueue.add).toHaveBeenCalledWith(
        'notify-pipeline',
        expect.objectContaining({ type: PaperTradingJobType.NOTIFY_PIPELINE, pipelineId: 'pipe-1' }),
        expect.objectContaining({ jobId: 'paper-trading-notify-session-5' })
      );
    });

    it('skips pipeline notification when no pipelineId', async () => {
      const session = { id: 'session-np', status: PaperTradingStatus.ACTIVE, pipelineId: undefined } as any;
      jest.spyOn(service, 'findOne').mockResolvedValue(session);

      await service.stop('session-np', mockUser);

      expect(paperTradingQueue.add).toHaveBeenCalledTimes(1);
      expect(paperTradingQueue.add).toHaveBeenCalledWith('stop-session', expect.anything(), expect.anything());
    });

    it('rejects when already stopped or completed', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.STOPPED } as any);
      await expect(service.stop('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);

      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.COMPLETED } as any);
      await expect(service.stop('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('pause', () => {
    it('pauses atomically via transaction and removes tick jobs', async () => {
      const transactionalEntityManager = { save: jest.fn() };
      dataSource.transaction.mockImplementation((callback: any) => callback(transactionalEntityManager));

      const session = { id: 'session-6', status: PaperTradingStatus.ACTIVE, tickIntervalMs: 30000 } as any;
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce({ ...session, status: PaperTradingStatus.PAUSED });

      const result = await service.pause('session-6', mockUser);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(transactionalEntityManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaperTradingStatus.PAUSED })
      );
      expect(jobService.removeTickJobs).toHaveBeenCalledWith('session-6');
      expect(result.status).toBe(PaperTradingStatus.PAUSED);
    });

    it('rejects when session is not active', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.PAUSED } as any);

      await expect(service.pause('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('resume', () => {
    it('resumes atomically via transaction and schedules tick job', async () => {
      const transactionalEntityManager = { save: jest.fn() };
      dataSource.transaction.mockImplementation((callback: any) => callback(transactionalEntityManager));

      const session = { id: 'session-7', status: PaperTradingStatus.PAUSED, tickIntervalMs: 30000 } as any;
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValueOnce(session)
        .mockResolvedValueOnce({ ...session, status: PaperTradingStatus.ACTIVE });

      const result = await service.resume('session-7', mockUser);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(transactionalEntityManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: PaperTradingStatus.ACTIVE, consecutiveErrors: 0 })
      );
      expect(jobService.scheduleTickJob).toHaveBeenCalledWith('session-7', mockUser.id, 30000);
      expect(result.status).toBe(PaperTradingStatus.ACTIVE);
    });

    it('rejects when session is not paused', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.ACTIVE } as any);

      await expect(service.resume('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('delete', () => {
    it('removes tick jobs and deletes session', async () => {
      const session = { id: 'session-del', status: PaperTradingStatus.PAUSED } as any;
      jest.spyOn(service, 'findOne').mockResolvedValue(session);

      await service.delete('session-del', mockUser);

      expect(jobService.removeTickJobs).toHaveBeenCalledWith('session-del');
      expect(sessionRepository.remove).toHaveBeenCalledWith(session);
    });

    it('rejects when session is active', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ id: 's', status: PaperTradingStatus.ACTIVE } as any);

      await expect(service.delete('s', mockUser)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getPerformance', () => {
    it('delegates to jobService.calculateMetrics', async () => {
      const session = {
        id: 'session-10',
        initialCapital: 10000,
        currentPortfolioValue: 12000,
        user: mockUser
      };

      jest.spyOn(service, 'findOne').mockResolvedValue(session as any);
      jobService.calculateMetrics.mockResolvedValue({
        initialCapital: 10000,
        currentPortfolioValue: 12000,
        totalReturn: 2000,
        totalReturnPercent: 20,
        maxDrawdown: 0.05,
        sharpeRatio: 1.2,
        winRate: 0.6,
        totalTrades: 50,
        winningTrades: 30,
        losingTrades: 20,
        totalFees: 100,
        durationHours: 168
      });

      const result = await service.getPerformance('session-10', mockUser);

      expect(jobService.calculateMetrics).toHaveBeenCalledWith(session);
      expect(result.initialCapital).toBe(10000);
      expect(result.currentPortfolioValue).toBe(12000);
      expect(result.totalReturn).toBe(2000);
      expect(result.totalReturnPercent).toBe(20);
      expect(result.totalFees).toBe(100);
      expect(result.durationHours).toBeCloseTo(168, 0);
    });
  });

  describe('startFromPipeline', () => {
    it('creates session, sets pipeline fields, and auto-starts', async () => {
      const pipelineSession = {
        id: 'pipe-session',
        status: PaperTradingStatus.PAUSED,
        pipelineId: undefined,
        riskLevel: undefined,
        exitConfig: undefined,
        minTrades: undefined
      } as any;

      const startedSession = { ...pipelineSession, status: PaperTradingStatus.ACTIVE };

      jest.spyOn(service, 'create').mockResolvedValue(pipelineSession);
      sessionRepository.save.mockResolvedValue(pipelineSession);
      jest.spyOn(service, 'start').mockResolvedValue(startedSession);

      const result = await service.startFromPipeline({
        userId: mockUser.id,
        pipelineId: 'pipe-1',
        algorithmId: 'algo-1',
        exchangeKeyId: 'key-1',
        initialCapital: 10000,
        riskLevel: 3,
        exitConfig: { stopLoss: 0.05 },
        minTrades: 20
      } as any);

      expect(service.create).toHaveBeenCalled();
      expect(pipelineSession.pipelineId).toBe('pipe-1');
      expect(pipelineSession.riskLevel).toBe(3);
      expect(pipelineSession.exitConfig).toEqual({ stopLoss: 0.05 });
      expect(pipelineSession.minTrades).toBe(20);
      expect(sessionRepository.save).toHaveBeenCalledWith(pipelineSession);
      expect(service.start).toHaveBeenCalledWith('pipe-session', expect.objectContaining({ id: mockUser.id }));
      expect(result.status).toBe(PaperTradingStatus.ACTIVE);
    });
  });
});
