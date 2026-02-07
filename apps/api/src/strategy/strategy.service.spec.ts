import { BadRequestException, NotFoundException } from '@nestjs/common';

import { Repository } from 'typeorm';

import {
  AuditEventType,
  CreateStrategyConfigDto,
  StrategyConfigListFilters,
  StrategyStatus,
  UpdateStrategyConfigDto
} from '@chansey/api-interfaces';

import { BacktestRun } from './entities/backtest-run.entity';
import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';
import { StrategyService } from './strategy.service';

import { AlgorithmService } from '../algorithm/algorithm.service';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../metrics/metrics.service';

type MockRepo<T> = jest.Mocked<Repository<T>>;

const createStrategy = (overrides: Partial<StrategyConfig> = {}): StrategyConfig =>
  ({
    id: overrides.id ?? 'strategy-1',
    name: overrides.name ?? 'Momentum',
    algorithmId: overrides.algorithmId ?? 'algo-1',
    parameters: overrides.parameters ?? { window: 14 },
    version: overrides.version ?? '1.0.0',
    status: overrides.status ?? StrategyStatus.LIVE,
    shadowStatus: overrides.shadowStatus ?? 'shadow',
    heartbeatFailures: overrides.heartbeatFailures ?? 0,
    lastHeartbeat: overrides.lastHeartbeat === undefined ? new Date() : overrides.lastHeartbeat,
    lastError: overrides.lastError ?? null,
    lastErrorAt: overrides.lastErrorAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date()
  }) as StrategyConfig;

const createQueryBuilderMock = () => {
  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getCount: jest.fn(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
    where: jest.fn().mockReturnThis()
  };
  return qb;
};

describe('StrategyService', () => {
  let service: StrategyService;
  let strategyRepo: MockRepo<StrategyConfig>;
  let backtestRunRepo: MockRepo<BacktestRun>;
  let strategyScoreRepo: MockRepo<StrategyScore>;
  let algorithmService: jest.Mocked<AlgorithmService>;
  let algorithmRegistry: jest.Mocked<AlgorithmRegistry>;
  let auditService: jest.Mocked<AuditService>;
  let metricsService: jest.Mocked<MetricsService>;

  beforeEach(() => {
    strategyRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      remove: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn()
    } as unknown as MockRepo<StrategyConfig>;

    backtestRunRepo = { findOne: jest.fn() } as unknown as MockRepo<BacktestRun>;
    strategyScoreRepo = { findOne: jest.fn() } as unknown as MockRepo<StrategyScore>;

    algorithmService = { getAlgorithmById: jest.fn() } as unknown as jest.Mocked<AlgorithmService>;
    algorithmRegistry = { getStrategyForAlgorithm: jest.fn() } as unknown as jest.Mocked<AlgorithmRegistry>;
    auditService = { createAuditLog: jest.fn() } as unknown as jest.Mocked<AuditService>;
    metricsService = {
      recordStrategyHeartbeat: jest.fn(),
      setStrategyHeartbeatFailures: jest.fn(),
      setStrategyHeartbeatAge: jest.fn(),
      calculateAndSetHealthScore: jest.fn()
    } as unknown as jest.Mocked<MetricsService>;

    service = new StrategyService(
      strategyRepo,
      backtestRunRepo,
      strategyScoreRepo,
      algorithmService,
      algorithmRegistry,
      auditService,
      metricsService
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe('create', () => {
    const dto: CreateStrategyConfigDto = {
      name: 'Momentum',
      algorithmId: 'algo-1',
      parameters: { window: 10 }
    };

    it('creates a strategy when algorithm exists and is registered', async () => {
      algorithmService.getAlgorithmById.mockResolvedValue({ id: 'algo-1', name: 'Algo', config: {} } as any);
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({} as any);
      strategyRepo.create.mockReturnValue(createStrategy({ id: 'created-id', name: dto.name }));
      strategyRepo.save.mockResolvedValue(createStrategy({ id: 'created-id', name: dto.name }));

      const result = await service.create(dto, 'user-1');

      expect(result.id).toBe('created-id');
      expect(strategyRepo.save).toHaveBeenCalled();
      expect(auditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.STRATEGY_CREATED,
          entityId: 'created-id'
        })
      );
    });

    it('throws when algorithm is missing', async () => {
      algorithmService.getAlgorithmById.mockResolvedValue(null as any);

      await expect(service.create(dto)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when algorithm is not registered', async () => {
      algorithmService.getAlgorithmById.mockResolvedValue({ id: 'algo-1', name: 'Algo', config: {} } as any);
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue(undefined);

      await expect(service.create(dto)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('returns strategy if found', async () => {
      const strategy = createStrategy();
      strategyRepo.findOne.mockResolvedValue(strategy);

      await expect(service.findOne('strategy-1')).resolves.toEqual(strategy);
    });

    it('throws when not found', async () => {
      strategyRepo.findOne.mockResolvedValue(null as any);

      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('applies filters, sorting, and pagination', async () => {
      const qb = createQueryBuilderMock();
      const strategies = [createStrategy({ id: '1' }), createStrategy({ id: '2' })];
      qb.getCount.mockResolvedValue(2);
      qb.getMany.mockResolvedValue(strategies);
      strategyRepo.createQueryBuilder.mockReturnValue(qb as any);

      const filters: StrategyConfigListFilters = {
        status: [StrategyStatus.LIVE],
        algorithmId: 'algo-1',
        search: 'momentum',
        sortBy: 'name',
        sortOrder: 'ASC',
        limit: 10,
        offset: 5
      };

      const result = await service.findAll(filters);

      expect(qb.andWhere).toHaveBeenCalledTimes(3);
      expect(qb.orderBy).toHaveBeenCalledWith('strategy.name', 'ASC');
      expect(qb.skip).toHaveBeenCalledWith(5);
      expect(qb.take).toHaveBeenCalledWith(10);
      expect(result).toEqual({ strategies, total: 2 });
    });
  });

  describe('update and delete', () => {
    it('updates a strategy and logs audit', async () => {
      const existing = createStrategy({ name: 'Old Name', parameters: { window: 5 }, status: StrategyStatus.DRAFT });
      strategyRepo.findOne.mockResolvedValue(existing);
      strategyRepo.save.mockImplementation(async (value) => value as any);

      const dto: UpdateStrategyConfigDto = {
        name: 'New Name',
        parameters: { window: 10 },
        status: StrategyStatus.LIVE
      };
      const updated = await service.update('strategy-1', dto, 'user-1');

      expect(updated.name).toBe('New Name');
      expect(strategyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'New Name', parameters: { window: 10 } })
      );
      expect(auditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.STRATEGY_UPDATED,
          beforeState: expect.objectContaining({ name: 'Old Name' }),
          afterState: expect.objectContaining({ name: 'New Name' })
        })
      );
    });

    it('removes a strategy and logs audit', async () => {
      const strategy = createStrategy();
      strategyRepo.findOne.mockResolvedValue(strategy);
      strategyRepo.remove.mockResolvedValue(strategy as any);

      await service.delete(strategy.id, 'user-1');

      expect(strategyRepo.remove).toHaveBeenCalledWith(strategy);
      expect(auditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: AuditEventType.STRATEGY_DELETED,
          entityId: strategy.id
        })
      );
    });
  });

  describe('getStrategyInstance', () => {
    it('merges algorithm defaults with strategy parameters', async () => {
      const strategy = createStrategy({ parameters: { risk: 0.5 } });
      strategyRepo.findOne.mockResolvedValue(strategy);
      algorithmService.getAlgorithmById.mockResolvedValue({
        id: strategy.algorithmId,
        name: 'Algo',
        config: { parameters: { base: true, risk: 0.1 } }
      } as any);
      algorithmRegistry.getStrategyForAlgorithm.mockResolvedValue({ execute: jest.fn() } as any);

      const result = await service.getStrategyInstance(strategy.id);

      expect(result.config).toEqual({ base: true, risk: 0.5 });
      expect(result.strategy).toBeDefined();
    });
  });

  describe('latest run/score', () => {
    it('returns latest backtest run and score', async () => {
      const run = { id: 'run-1' } as BacktestRun;
      const score = { id: 'score-1' } as StrategyScore;
      backtestRunRepo.findOne.mockResolvedValue(run);
      strategyScoreRepo.findOne.mockResolvedValue(score);

      await expect(service.getLatestBacktestRun('id')).resolves.toBe(run);
      await expect(service.getLatestScore('id')).resolves.toBe(score);
    });
  });

  describe('heartbeats', () => {
    it('records successful heartbeat and resets failures', async () => {
      const strategy = createStrategy({ heartbeatFailures: 2, lastError: 'err' });
      strategyRepo.findOne.mockResolvedValue(strategy);
      strategyRepo.save.mockImplementation(async (value) => value as any);

      await service.recordHeartbeat(strategy.id);

      expect(strategyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ heartbeatFailures: 0, lastError: null })
      );
      expect(metricsService.recordStrategyHeartbeat).toHaveBeenCalledWith(strategy.name, 'success');
      expect(metricsService.setStrategyHeartbeatFailures).toHaveBeenCalledWith(strategy.name, 0);
    });

    it('records failed heartbeat and increments failures', async () => {
      const strategy = createStrategy({ heartbeatFailures: 1 });
      strategyRepo.findOne.mockResolvedValue(strategy);
      strategyRepo.save.mockImplementation(async (value) => value as any);

      await service.recordHeartbeatFailure(strategy.id, 'boom');

      expect(strategyRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ heartbeatFailures: 2, lastError: 'boom', lastErrorAt: expect.any(Date) })
      );
      expect(metricsService.recordStrategyHeartbeat).toHaveBeenCalledWith(strategy.name, 'failed');
      expect(metricsService.setStrategyHeartbeatFailures).toHaveBeenCalledWith(strategy.name, 2);
    });

    it('updates heartbeat metrics for active strategies', async () => {
      const now = new Date('2024-01-01T00:00:00Z').getTime();
      jest.spyOn(Date, 'now').mockReturnValue(now);
      const withHeartbeat = createStrategy({
        name: 'WithHeartbeat',
        status: StrategyStatus.LIVE,
        lastHeartbeat: new Date(now - 300 * 1000),
        heartbeatFailures: 1
      });
      const withoutHeartbeat = createStrategy({
        name: 'NoHeartbeat',
        status: StrategyStatus.TESTING,
        lastHeartbeat: null,
        heartbeatFailures: 0
      });
      strategyRepo.find.mockResolvedValue([withHeartbeat, withoutHeartbeat]);

      await service.updateHeartbeatMetrics();

      expect(metricsService.setStrategyHeartbeatAge).toHaveBeenCalledWith(
        'WithHeartbeat',
        withHeartbeat.shadowStatus,
        300
      );
      expect(metricsService.calculateAndSetHealthScore).toHaveBeenCalledWith(
        'NoHeartbeat',
        withoutHeartbeat.shadowStatus,
        99999,
        0,
        300
      );
      expect(metricsService.setStrategyHeartbeatFailures).toHaveBeenCalledWith('WithHeartbeat', 1);
      expect(metricsService.setStrategyHeartbeatFailures).toHaveBeenCalledWith('NoHeartbeat', 0);
    });
  });

  describe('status queries', () => {
    it('returns strategies by status', async () => {
      const strategies = [createStrategy()];
      strategyRepo.find.mockResolvedValue(strategies);

      await expect(service.findByStatus(StrategyStatus.LIVE)).resolves.toEqual(strategies);
    });

    it('updates status via update()', async () => {
      const updated = createStrategy({ status: StrategyStatus.TESTING });
      jest.spyOn(service, 'update').mockResolvedValue(updated);

      const result = await service.updateStatus('id', StrategyStatus.TESTING, 'user');

      expect(result).toBe(updated);
      expect(service.update).toHaveBeenCalledWith('id', { status: StrategyStatus.TESTING }, 'user');
    });
  });

  describe('stale heartbeat queries', () => {
    it('finds stale heartbeats', async () => {
      const qb = createQueryBuilderMock();
      const stale = [createStrategy()];
      qb.getMany.mockResolvedValue(stale);
      strategyRepo.createQueryBuilder.mockReturnValue(qb as any);

      const result = await service.getStrategiesWithStaleHeartbeats(15);

      expect(qb.where).toHaveBeenCalled();
      expect(qb.andWhere).toHaveBeenCalled();
      expect(result).toEqual(stale);
    });

    it('filters strategies with heartbeat failures', async () => {
      const strategies = [
        createStrategy({ heartbeatFailures: 1, status: StrategyStatus.LIVE }),
        createStrategy({ heartbeatFailures: 4, status: StrategyStatus.TESTING })
      ];
      strategyRepo.find.mockResolvedValue(strategies);

      const result = await service.getStrategiesWithHeartbeatFailures(3);

      expect(result).toHaveLength(1);
      expect(result[0].heartbeatFailures).toBe(4);
    });
  });
});
