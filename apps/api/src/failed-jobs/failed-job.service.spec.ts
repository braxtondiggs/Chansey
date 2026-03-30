import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { FailedJobLog, FailedJobSeverity, FailedJobStatus } from './entities/failed-job-log.entity';
import { FailedJobAlertService } from './failed-job-alert.service';
import { FailedJobService } from './failed-job.service';

import { AuditService } from '../audit/audit.service';

describe('FailedJobService', () => {
  let service: FailedJobService;
  let repo: jest.Mocked<Repository<FailedJobLog>>;
  let auditService: jest.Mocked<AuditService>;
  let alertService: jest.Mocked<FailedJobAlertService>;
  let moduleRef: jest.Mocked<ModuleRef>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FailedJobService,
        {
          provide: getRepositoryToken(FailedJobLog),
          useValue: {
            create: jest.fn((dto) => ({ id: 'test-id', ...dto })),
            save: jest.fn((entity) => Promise.resolve({ id: 'test-id', ...entity })),
            findOne: jest.fn(),
            update: jest.fn(),
            createQueryBuilder: jest.fn()
          }
        },
        {
          provide: AuditService,
          useValue: { createAuditLog: jest.fn().mockResolvedValue({}) }
        },
        {
          provide: FailedJobAlertService,
          useValue: { recordFailure: jest.fn() }
        },
        {
          provide: ModuleRef,
          useValue: { get: jest.fn() }
        }
      ]
    }).compile();

    service = module.get(FailedJobService);
    repo = module.get(getRepositoryToken(FailedJobLog));
    auditService = module.get(AuditService);
    alertService = module.get(FailedJobAlertService);
    moduleRef = module.get(ModuleRef);
  });

  describe('classifySeverity', () => {
    it.each([
      ['trade-execution', FailedJobSeverity.CRITICAL],
      ['order-queue', FailedJobSeverity.CRITICAL],
      ['live-trading-cron', FailedJobSeverity.CRITICAL],
      ['position-monitor', FailedJobSeverity.HIGH],
      ['liquidation-monitor', FailedJobSeverity.HIGH]
    ])('should classify "%s" as %s (direct map)', (queue, expected) => {
      expect(service.classifySeverity(queue)).toBe(expected);
    });

    it.each([
      ['backtest-historical', FailedJobSeverity.MEDIUM],
      ['pipeline-stage', FailedJobSeverity.MEDIUM],
      ['optimization-run', FailedJobSeverity.MEDIUM]
    ])('should classify "%s" as MEDIUM (prefix match)', (queue, expected) => {
      expect(service.classifySeverity(queue)).toBe(expected);
    });

    it('should classify unknown queues as LOW', () => {
      expect(service.classifySeverity('some-other-queue')).toBe(FailedJobSeverity.LOW);
    });
  });

  describe('recordFailure', () => {
    const baseParams = {
      queueName: 'order-queue',
      jobId: 'job-1',
      jobName: 'sync-orders',
      errorMessage: 'Connection timeout'
    };

    it('should create, save, and return the failure record', async () => {
      const result = await service.recordFailure(baseParams);

      expect(result).not.toBeNull();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          queueName: 'order-queue',
          jobId: 'job-1',
          severity: FailedJobSeverity.CRITICAL,
          status: FailedJobStatus.PENDING
        })
      );
      expect(repo.save).toHaveBeenCalled();
    });

    it('should audit CRITICAL failures but not lower severities', async () => {
      await service.recordFailure({ ...baseParams, queueName: 'trade-execution' });
      expect(auditService.createAuditLog).toHaveBeenCalled();

      auditService.createAuditLog.mockClear();

      await service.recordFailure({ ...baseParams, queueName: 'some-queue' });
      expect(auditService.createAuditLog).not.toHaveBeenCalled();
    });

    it('should notify alert service with correct severity', async () => {
      await service.recordFailure({ ...baseParams, queueName: 'trade-execution' });
      expect(alertService.recordFailure).toHaveBeenCalledWith(FailedJobSeverity.CRITICAL);
    });

    it('should return null when repo.save throws (fail-safe)', async () => {
      repo.save.mockRejectedValueOnce(new Error('DB unavailable'));
      const result = await service.recordFailure(baseParams);
      expect(result).toBeNull();
    });

    it('should still return saved entry when audit throws (audit failure swallowed)', async () => {
      auditService.createAuditLog.mockRejectedValueOnce(new Error('Audit DB down'));
      const result = await service.recordFailure({ ...baseParams, queueName: 'trade-execution' });
      expect(result).not.toBeNull();
    });

    it('should extract userId from jobData.userId and context keys', async () => {
      await service.recordFailure({
        ...baseParams,
        queueName: 'trade-execution',
        jobData: { userId: 'user-123', symbol: 'BTC/USDT', action: 'buy' }
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          context: expect.objectContaining({ symbol: 'BTC/USDT', action: 'buy' })
        })
      );
    });

    it('should extract userId from nested jobData.user.id', async () => {
      await service.recordFailure({
        ...baseParams,
        jobData: { user: { id: 'user-456' } }
      });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-456' }));
    });

    it('should set userId and context to null when no jobData', async () => {
      await service.recordFailure(baseParams);

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ userId: null, context: null }));
    });

    it('should redact sensitive keys in jobData while preserving safe keys', async () => {
      await service.recordFailure({
        ...baseParams,
        jobData: { userId: 'user-1', apiKey: 'sk-123', apiSecret: 'sec', symbol: 'BTC/USDT' }
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          jobData: { userId: 'user-1', apiKey: '[REDACTED]', apiSecret: '[REDACTED]', symbol: 'BTC/USDT' }
        })
      );
    });

    it('should redact sensitive keys nested in objects and arrays', async () => {
      await service.recordFailure({
        ...baseParams,
        jobData: {
          userId: 'user-1',
          exchangeKey: { id: 'ek-1', secret: 'my-secret', apiKey: 'key-123' },
          credentials: [{ token: 'tok-1', label: 'main' }],
          symbol: 'BTC/USDT'
        }
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          jobData: {
            userId: 'user-1',
            exchangeKey: { id: 'ek-1', secret: '[REDACTED]', apiKey: '[REDACTED]' },
            credentials: [{ token: '[REDACTED]', label: 'main' }],
            symbol: 'BTC/USDT'
          }
        })
      );
    });
  });

  describe('findOne', () => {
    it('should return the entry when found', async () => {
      const entry = { id: 'entry-1', queueName: 'order-queue' } as FailedJobLog;
      repo.findOne.mockResolvedValueOnce(entry);

      const result = await service.findOne('entry-1');
      expect(result).toBe(entry);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'entry-1' } });
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      repo.findOne.mockResolvedValueOnce(null);
      await expect(service.findOne('missing-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('reviewJob', () => {
    it('should update status, reviewer, and audit the review', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'entry-1',
        status: FailedJobStatus.PENDING
      } as FailedJobLog);

      await service.reviewJob('entry-1', { status: FailedJobStatus.REVIEWED, adminNotes: 'Checked' }, 'admin-1');

      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: FailedJobStatus.REVIEWED,
          reviewedBy: 'admin-1',
          adminNotes: 'Checked'
        })
      );
      expect(auditService.createAuditLog).toHaveBeenCalled();
    });

    it('should throw NotFoundException when entry does not exist', async () => {
      repo.findOne.mockResolvedValueOnce(null);

      await expect(service.reviewJob('missing', { status: FailedJobStatus.REVIEWED }, 'admin-1')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('retryJob', () => {
    const mockQueue = { add: jest.fn().mockResolvedValue({}) };

    it('should resolve queue, re-enqueue job, and update status to RETRIED', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'entry-1',
        queueName: 'order-queue',
        jobId: 'job-1',
        jobName: 'sync-orders',
        jobData: { userId: 'u1' },
        errorMessage: 'Test error',
        attemptsMade: 1,
        maxAttempts: 3,
        severity: FailedJobSeverity.CRITICAL,
        status: FailedJobStatus.PENDING,
        createdAt: new Date()
      } as FailedJobLog);
      moduleRef.get.mockReturnValueOnce(mockQueue);

      const result = await service.retryJob('entry-1', 'admin-1');

      expect(mockQueue.add).toHaveBeenCalledWith(
        'sync-orders',
        { userId: 'u1' },
        expect.objectContaining({ attempts: 3 })
      );
      expect(result).toEqual(expect.objectContaining({ status: FailedJobStatus.RETRIED, reviewedBy: 'admin-1' }));
      expect(auditService.createAuditLog).toHaveBeenCalled();
    });

    it('should reject retry when status is RETRIED', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'entry-1',
        queueName: 'order-queue',
        status: FailedJobStatus.RETRIED
      } as FailedJobLog);

      await expect(service.retryJob('entry-1', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('should reject retry when status is DISMISSED', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'entry-1',
        queueName: 'order-queue',
        status: FailedJobStatus.DISMISSED
      } as FailedJobLog);

      await expect(service.retryJob('entry-1', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('should reject retry for non-retryable cron queues', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'entry-1',
        queueName: 'live-trading-cron',
        status: FailedJobStatus.PENDING
      } as FailedJobLog);

      await expect(service.retryJob('entry-1', 'admin-1')).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when queue is not registered', async () => {
      repo.findOne.mockResolvedValueOnce({
        id: 'entry-1',
        queueName: 'unknown-queue',
        jobId: 'job-1',
        jobName: 'some-job',
        errorMessage: 'Error',
        attemptsMade: 1,
        maxAttempts: 3,
        severity: FailedJobSeverity.LOW,
        status: FailedJobStatus.PENDING,
        createdAt: new Date()
      } as FailedJobLog);
      moduleRef.get.mockImplementationOnce(() => {
        throw new Error('not found');
      });

      await expect(service.retryJob('entry-1', 'admin-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulkDismiss', () => {
    it('should update matching PENDING entries and return affected count', async () => {
      repo.update.mockResolvedValueOnce({ affected: 3 } as any);

      const result = await service.bulkDismiss(['id-1', 'id-2', 'id-3'], 'admin-1');

      expect(result).toBe(3);
      expect(repo.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: FailedJobStatus.PENDING }),
        expect.objectContaining({ status: FailedJobStatus.DISMISSED, reviewedBy: 'admin-1' })
      );
    });

    it('should return 0 when no entries match', async () => {
      repo.update.mockResolvedValueOnce({ affected: 0 } as any);
      const result = await service.bulkDismiss(['nonexistent'], 'admin-1');
      expect(result).toBe(0);
    });
  });

  describe('findAll', () => {
    let mockQb: Record<string, jest.Mock>;

    beforeEach(() => {
      mockQb = {
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0])
      };
      repo.createQueryBuilder.mockReturnValue(mockQb as any);
    });

    it('should apply all provided filters', async () => {
      const result = await service.findAll({
        queueName: 'trade-execution',
        status: FailedJobStatus.PENDING,
        severity: FailedJobSeverity.CRITICAL,
        limit: 10,
        offset: 5
      });

      expect(mockQb.andWhere).toHaveBeenCalledTimes(3);
      expect(mockQb.take).toHaveBeenCalledWith(10);
      expect(mockQb.skip).toHaveBeenCalledWith(5);
      expect(result).toEqual({ data: [], total: 0 });
    });

    it('should use default limit=50 and offset=0 when not provided', async () => {
      await service.findAll({});

      expect(mockQb.andWhere).not.toHaveBeenCalled();
      expect(mockQb.take).toHaveBeenCalledWith(50);
      expect(mockQb.skip).toHaveBeenCalledWith(0);
    });
  });
});
