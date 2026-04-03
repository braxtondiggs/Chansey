import { AuditEventType } from '@chansey/api-interfaces';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

import { RequestContext } from '../common/cls/request-context.service';
import { CryptoService } from '../common/crypto.service';

describe('AuditService', () => {
  let service: AuditService;
  let cryptoService: CryptoService;
  let mockRepo: any;
  let mockRequestContext: Partial<RequestContext>;

  beforeEach(() => {
    cryptoService = new CryptoService();

    mockRepo = {
      create: jest.fn((data: any) => ({ id: 'audit-1', ...data })),
      save: jest.fn((entity: any) => Promise.resolve(entity)),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn()
    };

    mockRequestContext = {
      userId: 'cls-user-1',
      ipAddress: '10.0.0.1',
      userAgent: 'TestAgent/1.0'
    };

    service = new AuditService(mockRepo, cryptoService, mockRequestContext as RequestContext);
  });

  describe('createAuditLog — CLS fallback enrichment', () => {
    const baseDto = {
      eventType: AuditEventType.STRATEGY_MODIFIED,
      entityType: 'StrategyConfig',
      entityId: 'entity-1'
    } as any;

    it('uses DTO values when provided', async () => {
      await service.createAuditLog({
        ...baseDto,
        userId: 'dto-user',
        ipAddress: '192.168.1.1',
        userAgent: 'DtoAgent/2.0'
      });

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.userId).toBe('dto-user');
      expect(created.userAgent).toBe('DtoAgent/2.0');
    });

    it('falls back to CLS values when DTO fields are absent', async () => {
      await service.createAuditLog(baseDto);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.userId).toBe('cls-user-1');
      expect(created.userAgent).toBe('TestAgent/1.0');
    });

    it('handles missing RequestContext gracefully', async () => {
      const serviceNoCtx = new AuditService(mockRepo, cryptoService, undefined as any);

      await serviceNoCtx.createAuditLog(baseDto);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.userId).toBeUndefined();
    });

    it('hashes ipAddress when provided via DTO', async () => {
      await service.createAuditLog({ ...baseDto, ipAddress: '192.168.1.1' });

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.ipAddress).toBe(cryptoService.hashSensitiveData('192.168.1.1'));
      expect(created.ipAddress).not.toBe('192.168.1.1');
    });

    it('hashes ipAddress from CLS fallback', async () => {
      await service.createAuditLog(baseDto);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.ipAddress).toBe(cryptoService.hashSensitiveData('10.0.0.1'));
    });

    it('sets ipAddress to null when neither DTO nor CLS provides one', async () => {
      const serviceNoCtx = new AuditService(mockRepo, cryptoService, undefined as any);
      await serviceNoCtx.createAuditLog(baseDto);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.ipAddress).toBeNull();
    });

    it('uses provided correlationId over CLS requestId', async () => {
      await service.createAuditLog({ ...baseDto, correlationId: 'corr-123' });

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.correlationId).toBe('corr-123');
    });

    it('falls back to CLS requestId when correlationId not provided', async () => {
      const ctxWithReqId = { ...mockRequestContext, requestId: 'req-id-from-cls' } as RequestContext;
      const svcWithReqId = new AuditService(mockRepo, cryptoService, ctxWithReqId);

      await svcWithReqId.createAuditLog(baseDto);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.correlationId).toBe('req-id-from-cls');
    });

    it('generates random UUID correlationId when neither DTO nor CLS provides one', async () => {
      await service.createAuditLog(baseDto);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('createAuditLog — chain hash', () => {
    const baseDto = {
      eventType: AuditEventType.STRATEGY_MODIFIED,
      entityType: 'StrategyConfig',
      entityId: 'entity-1'
    } as any;

    it('generates chainHash and saves twice', async () => {
      await service.createAuditLog(baseDto);

      expect(mockRepo.save).toHaveBeenCalledTimes(2);
      const secondSave = mockRepo.save.mock.calls[1][0];
      expect(secondSave.chainHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('uses previous entry chainHash when available', async () => {
      mockRepo.findOne.mockResolvedValueOnce({ chainHash: 'prev-hash-abc' });

      await service.createAuditLog(baseDto);

      const secondSave = mockRepo.save.mock.calls[1][0];
      // Should produce a different chainHash than when previousHash is null
      mockRepo.findOne.mockResolvedValueOnce(null);
      mockRepo.save.mockClear();
      mockRepo.create.mockClear();

      await service.createAuditLog(baseDto);
      const secondSaveNoPrev = mockRepo.save.mock.calls[1][0];

      expect(secondSave.chainHash).not.toBe(secondSaveNoPrev.chainHash);
    });

    it('excludes the saved entry when finding previous entry (Not(saved.id))', async () => {
      await service.createAuditLog(baseDto);

      const findOneCall = mockRepo.findOne.mock.calls[0][0];
      expect(findOneCall.where).toEqual({ id: expect.objectContaining({ _type: 'not' }) });
      expect(findOneCall.order).toEqual({ timestamp: 'DESC' });
    });
  });

  describe('integrity hash — includes userId', () => {
    it('verifies entry created with userId', async () => {
      await service.createAuditLog({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'entity-1',
        userId: 'user-42'
      } as any);

      const created = mockRepo.create.mock.calls[0][0];
      const auditLog = { ...created, timestamp: created.timestamp } as AuditLog;

      expect(service.verifyIntegrity(auditLog)).toBe(true);
    });

    it('detects tampering when userId is changed', async () => {
      await service.createAuditLog({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'entity-1',
        userId: 'user-42'
      } as any);

      const created = mockRepo.create.mock.calls[0][0];
      const auditLog = { ...created } as AuditLog;
      auditLog.userId = 'tampered-user';

      expect(service.verifyIntegrity(auditLog)).toBe(false);
    });

    it('verifies integrity with undefined userId (coerced to null)', async () => {
      await service.createAuditLog({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'entity-1'
      } as any);

      // Clear CLS context to get undefined userId
      const serviceNoCtx = new AuditService(mockRepo, cryptoService, undefined as any);
      mockRepo.create.mockClear();

      await serviceNoCtx.createAuditLog({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'entity-1'
      } as any);

      const created = mockRepo.create.mock.calls[0][0];
      const auditLog = { ...created } as AuditLog;

      expect(serviceNoCtx.verifyIntegrity(auditLog)).toBe(true);
    });
  });

  describe('queryAuditTrail', () => {
    let mockQb: any;

    beforeEach(() => {
      mockQb = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(2),
        getMany: jest.fn().mockResolvedValue([{ id: 'a-1' }, { id: 'a-2' }])
      };
      mockRepo.createQueryBuilder.mockReturnValue(mockQb);
    });

    it('applies entityType and userId filters', async () => {
      await service.queryAuditTrail({ entityType: 'StrategyConfig', userId: 'u-1' });

      const calls = mockQb.andWhere.mock.calls.map((c: any) => c[0]);
      expect(calls).toContain('audit.entityType = :entityType');
      expect(calls).toContain('audit.userId = :userId');
    });

    it('handles eventType as array with IN clause', async () => {
      await service.queryAuditTrail({
        eventType: [AuditEventType.STRATEGY_MODIFIED, AuditEventType.STRATEGY_PROMOTED]
      });

      const calls = mockQb.andWhere.mock.calls.map((c: any) => c[0]);
      expect(calls).toContain('audit.eventType IN (:...eventTypes)');
    });

    it('handles eventType as single value', async () => {
      await service.queryAuditTrail({ eventType: AuditEventType.STRATEGY_MODIFIED });

      const calls = mockQb.andWhere.mock.calls.map((c: any) => c[0]);
      expect(calls).toContain('audit.eventType = :eventType');
    });

    it('applies date range filters', async () => {
      await service.queryAuditTrail({
        startDate: '2025-01-01',
        endDate: '2025-12-31'
      });

      const calls = mockQb.andWhere.mock.calls.map((c: any) => c[0]);
      expect(calls).toContain('audit.timestamp >= :startDate');
      expect(calls).toContain('audit.timestamp <= :endDate');
    });

    it('uses default pagination when not specified', async () => {
      await service.queryAuditTrail({});

      expect(mockQb.skip).toHaveBeenCalledWith(0);
      expect(mockQb.take).toHaveBeenCalledWith(100);
    });

    it('applies custom pagination', async () => {
      await service.queryAuditTrail({ limit: 25, offset: 50 });

      expect(mockQb.skip).toHaveBeenCalledWith(50);
      expect(mockQb.take).toHaveBeenCalledWith(25);
    });

    it('returns logs and total count', async () => {
      const result = await service.queryAuditTrail({});

      expect(result).toEqual({ logs: [{ id: 'a-1' }, { id: 'a-2' }], total: 2 });
    });
  });

  describe('logDeploymentLifecycle — event type mapping', () => {
    it.each([
      ['created', AuditEventType.STRATEGY_PROMOTED],
      ['activated', AuditEventType.DEPLOYMENT_ACTIVATED],
      ['paused', AuditEventType.DEPLOYMENT_PAUSED],
      ['resumed', AuditEventType.DEPLOYMENT_RESUMED],
      ['demoted', AuditEventType.STRATEGY_DEMOTED],
      ['terminated', AuditEventType.DEPLOYMENT_TERMINATED]
    ] as const)('maps "%s" to %s', async (event, expectedType) => {
      await service.logDeploymentLifecycle({
        deploymentId: 'deploy-1',
        userId: 'u-1',
        event,
        beforeState: null,
        afterState: null,
        reason: 'test reason'
      });

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.eventType).toBe(expectedType);
      expect(created.metadata).toEqual(expect.objectContaining({ lifecycleEvent: event }));
    });
  });

  describe('verifyMultipleEntries', () => {
    it('returns verified count and failed IDs', async () => {
      const timestamp = new Date();
      const goodIntegrity = cryptoService.generateAuditIntegrityHash({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'e-1',
        userId: 'u-1',
        timestamp
      });

      const goodEntry = {
        id: 'good-1',
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'e-1',
        userId: 'u-1',
        timestamp,
        integrity: goodIntegrity
      };

      const badEntry = {
        id: 'bad-1',
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'e-1',
        userId: 'tampered',
        timestamp,
        integrity: goodIntegrity // integrity doesn't match tampered userId
      };

      mockRepo.find.mockResolvedValueOnce([goodEntry, badEntry]);

      const result = await service.verifyMultipleEntries(['good-1', 'bad-1']);

      expect(result.verified).toBe(1);
      expect(result.failed).toEqual(['bad-1']);
    });
  });
});
