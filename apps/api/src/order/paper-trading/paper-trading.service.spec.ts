import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { PaperTradingStatus } from './entities';
import { PaperTradingJobType } from './paper-trading.job-data';
import { PaperTradingService } from './paper-trading.service';

import type { User } from '../../users/users.entity';

describe('PaperTradingService', () => {
  const createService = (overrides: Partial<any> = {}) => {
    const sessionRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      remove: jest.fn(),
      update: jest.fn()
    };

    const accountRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn()
    };

    const orderRepository = {
      findAndCount: jest.fn(),
      createQueryBuilder: jest.fn()
    };

    const signalRepository = {
      findAndCount: jest.fn()
    };

    const snapshotRepository = {
      createQueryBuilder: jest.fn()
    };

    const algorithmRepository = {
      findOne: jest.fn()
    };

    const exchangeKeyRepository = {
      findOne: jest.fn()
    };

    const paperTradingQueue = {
      add: jest.fn(),
      removeJobScheduler: jest.fn()
    };

    const eventEmitter = {
      emit: jest.fn()
    };

    const dataSource = {
      transaction: jest.fn((callback) => callback(sessionRepository))
    };

    const service = new PaperTradingService(
      (overrides.sessionRepository ?? sessionRepository) as any,
      (overrides.accountRepository ?? accountRepository) as any,
      (overrides.orderRepository ?? orderRepository) as any,
      (overrides.signalRepository ?? signalRepository) as any,
      (overrides.snapshotRepository ?? snapshotRepository) as any,
      (overrides.algorithmRepository ?? algorithmRepository) as any,
      (overrides.exchangeKeyRepository ?? exchangeKeyRepository) as any,
      (overrides.paperTradingQueue ?? paperTradingQueue) as any,
      (overrides.eventEmitter ?? eventEmitter) as any,
      (overrides.dataSource ?? dataSource) as any
    );

    return {
      service,
      sessionRepository,
      accountRepository,
      orderRepository,
      signalRepository,
      snapshotRepository,
      algorithmRepository,
      exchangeKeyRepository,
      paperTradingQueue,
      eventEmitter,
      dataSource
    };
  };

  const mockUser = { id: 'user-1' } as User;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('throws when algorithm is missing on create', async () => {
    const { service, algorithmRepository } = createService();
    algorithmRepository.findOne.mockResolvedValue(null);

    await expect(
      service.create(
        {
          algorithmId: 'algo-1',
          exchangeKeyId: 'key-1',
          initialCapital: 1000
        } as any,
        mockUser
      )
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when exchange key is owned by another user', async () => {
    const { service, algorithmRepository, exchangeKeyRepository } = createService();
    algorithmRepository.findOne.mockResolvedValue({ id: 'algo-1' });
    exchangeKeyRepository.findOne.mockResolvedValue({ id: 'key-1', user: { id: 'other' } });

    await expect(
      service.create(
        {
          algorithmId: 'algo-1',
          exchangeKeyId: 'key-1',
          initialCapital: 1000
        } as any,
        mockUser
      )
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates a session and quote account', async () => {
    const { service, algorithmRepository, exchangeKeyRepository, sessionRepository, accountRepository } =
      createService();

    algorithmRepository.findOne.mockResolvedValue({ id: 'algo-1' });
    exchangeKeyRepository.findOne.mockResolvedValue({ id: 'key-1', user: { id: mockUser.id }, exchange: {} });

    const createdSession = { id: 'session-1' };
    sessionRepository.create.mockReturnValue(createdSession);
    sessionRepository.save.mockResolvedValue(createdSession);
    accountRepository.create.mockReturnValue({});
    accountRepository.save.mockResolvedValue({});

    const findOneSpy = jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-1' } as any);

    const result = await service.create(
      {
        algorithmId: 'algo-1',
        exchangeKeyId: 'key-1',
        initialCapital: 1000,
        quoteCurrency: 'USD'
      } as any,
      mockUser
    );

    expect(sessionRepository.save).toHaveBeenCalledWith(createdSession);
    expect(accountRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'USD', available: 1000, locked: 0 })
    );
    expect(findOneSpy).toHaveBeenCalledWith('session-1', mockUser);
    expect(result).toEqual({ id: 'session-1' });
  });

  it('starts a session and enqueues a start job', async () => {
    const { service, sessionRepository, paperTradingQueue } = createService();

    const session = { id: 'session-2', status: PaperTradingStatus.PAUSED } as any;
    const findOneSpy = jest
      .spyOn(service, 'findOne')
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ id: 'session-2', status: PaperTradingStatus.ACTIVE } as any);

    const result = await service.start('session-2', mockUser);

    expect(session.status).toBe(PaperTradingStatus.ACTIVE);
    expect(sessionRepository.save).toHaveBeenCalledWith(session);
    expect(paperTradingQueue.add).toHaveBeenCalledWith(
      'start-session',
      { type: PaperTradingJobType.START_SESSION, sessionId: 'session-2', userId: mockUser.id },
      { jobId: 'paper-trading-start-session-2' }
    );
    expect(findOneSpy).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ id: 'session-2', status: PaperTradingStatus.ACTIVE });
  });

  it('rejects start when already active', async () => {
    const { service } = createService();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-3', status: PaperTradingStatus.ACTIVE } as any);

    await expect(service.start('session-3', mockUser)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('removes job scheduler for session tick jobs', async () => {
    const { service, paperTradingQueue } = createService();

    paperTradingQueue.removeJobScheduler.mockResolvedValue(undefined);

    await service.removeTickJobs('session-4');

    expect(paperTradingQueue.removeJobScheduler).toHaveBeenCalledWith('paper-trading-tick-session-4');
  });

  it('stops a session and enqueues pipeline notification', async () => {
    const { service, paperTradingQueue } = createService();

    const session = { id: 'session-5', status: PaperTradingStatus.ACTIVE, pipelineId: 'pipe-1' } as any;
    jest.spyOn(service, 'findOne').mockResolvedValue(session);
    jest.spyOn(service, 'removeTickJobs').mockResolvedValue();

    const result = await service.stop('session-5', mockUser, 'user_cancelled');

    expect(session.status).toBe(PaperTradingStatus.STOPPED);
    expect(paperTradingQueue.add).toHaveBeenCalledWith(
      'stop-session',
      { type: PaperTradingJobType.STOP_SESSION, sessionId: 'session-5', userId: mockUser.id, reason: 'user_cancelled' },
      { jobId: 'paper-trading-stop-session-5' }
    );
    expect(paperTradingQueue.add).toHaveBeenCalledWith(
      'notify-pipeline',
      expect.objectContaining({
        type: PaperTradingJobType.NOTIFY_PIPELINE,
        sessionId: 'session-5',
        pipelineId: 'pipe-1',
        stoppedReason: 'user_cancelled',
        userId: mockUser.id
      }),
      expect.objectContaining({ jobId: 'paper-trading-notify-session-5' })
    );
    expect(result).toBe(session);
  });

  it('pauses a session atomically with transaction', async () => {
    const transactionalEntityManager = { save: jest.fn() };
    const dataSource = {
      transaction: jest.fn((callback) => callback(transactionalEntityManager))
    };
    const { service } = createService({ dataSource });

    const session = { id: 'session-6', status: PaperTradingStatus.ACTIVE, tickIntervalMs: 30000 } as any;
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ ...session, status: PaperTradingStatus.PAUSED });
    jest.spyOn(service, 'removeTickJobs').mockResolvedValue();

    const result = await service.pause('session-6', mockUser);

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(transactionalEntityManager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaperTradingStatus.PAUSED })
    );
    expect(result.status).toBe(PaperTradingStatus.PAUSED);
  });

  it('resumes a session atomically with transaction', async () => {
    const transactionalEntityManager = { save: jest.fn() };
    const dataSource = {
      transaction: jest.fn((callback) => callback(transactionalEntityManager))
    };
    const { service } = createService({ dataSource });

    const session = { id: 'session-7', status: PaperTradingStatus.PAUSED, tickIntervalMs: 30000 } as any;
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ ...session, status: PaperTradingStatus.ACTIVE });
    jest.spyOn(service, 'scheduleTickJob').mockResolvedValue();

    const result = await service.resume('session-7', mockUser);

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(transactionalEntityManager.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaperTradingStatus.ACTIVE, consecutiveErrors: 0 })
    );
    expect(result.status).toBe(PaperTradingStatus.ACTIVE);
  });

  it('rejects pause when session is not active', async () => {
    const { service } = createService();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-8', status: PaperTradingStatus.PAUSED } as any);

    await expect(service.pause('session-8', mockUser)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects resume when session is not paused', async () => {
    const { service } = createService();
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'session-9', status: PaperTradingStatus.ACTIVE } as any);

    await expect(service.resume('session-9', mockUser)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calculates performance metrics correctly', async () => {
    const { service, sessionRepository, orderRepository } = createService();

    const session = {
      id: 'session-10',
      initialCapital: 10000,
      currentPortfolioValue: 12000,
      maxDrawdown: 0.05,
      sharpeRatio: 1.2,
      winRate: 0.6,
      totalTrades: 50,
      winningTrades: 30,
      losingTrades: 20,
      startedAt: new Date('2024-01-01'),
      stoppedAt: new Date('2024-01-08'),
      user: mockUser
    };

    sessionRepository.findOne.mockResolvedValue(session);
    orderRepository.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ totalFees: 100 })
    });

    jest.spyOn(service, 'findOne').mockResolvedValue(session as any);

    const result = await service.getPerformance('session-10', mockUser);

    expect(result.initialCapital).toBe(10000);
    expect(result.currentPortfolioValue).toBe(12000);
    expect(result.totalReturn).toBe(2000);
    expect(result.totalReturnPercent).toBe(20);
    expect(result.durationHours).toBeGreaterThan(0);
  });
});
