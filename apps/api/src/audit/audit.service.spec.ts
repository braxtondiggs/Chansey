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

    it('generates correlationId when not provided', async () => {
      await service.createAuditLog(baseDto);

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('uses provided correlationId', async () => {
      await service.createAuditLog({ ...baseDto, correlationId: 'corr-123' });

      const created = mockRepo.create.mock.calls[0][0];
      expect(created.correlationId).toBe('corr-123');
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
      expect(secondSave.chainHash).toBeDefined();
      expect(typeof secondSave.chainHash).toBe('string');
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

    it('detects tampering when eventType is changed', async () => {
      await service.createAuditLog({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'entity-1'
      } as any);

      const created = mockRepo.create.mock.calls[0][0];
      const auditLog = { ...created } as AuditLog;
      auditLog.eventType = AuditEventType.BACKTEST_COMPLETED;

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

  describe('verifyAuditChain', () => {
    it('returns valid for empty entries', () => {
      const result = service.verifyAuditChain([]);

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
      expect(result.verifiedEntries).toBe(0);
      expect(result.brokenChainAt).toBeNull();
      expect(result.tamperedEntries).toEqual([]);
      expect(result.integrityFailures).toEqual([]);
    });

    it('validates a single-entry chain', () => {
      const timestamp = new Date();
      const integrity = cryptoService.generateAuditIntegrityHash({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'e-1',
        userId: 'u-1',
        timestamp
      });
      const chainHash = cryptoService.generateChainHash(
        {
          id: 'a-1',
          eventType: AuditEventType.STRATEGY_MODIFIED,
          entityType: 'StrategyConfig',
          entityId: 'e-1',
          timestamp,
          integrity
        },
        null
      );

      const entry = {
        id: 'a-1',
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'e-1',
        userId: 'u-1',
        timestamp,
        integrity,
        chainHash,
        beforeState: undefined,
        afterState: undefined,
        metadata: undefined
      } as unknown as AuditLog;

      const result = service.verifyAuditChain([entry]);

      expect(result.valid).toBe(true);
      expect(result.verifiedEntries).toBe(1);
      expect(result.integrityFailures).toEqual([]);
    });

    it('detects integrity failure in chain entry', () => {
      const timestamp = new Date();
      const integrity = cryptoService.generateAuditIntegrityHash({
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'e-1',
        userId: 'u-1',
        timestamp
      });
      const chainHash = cryptoService.generateChainHash(
        {
          id: 'a-1',
          eventType: AuditEventType.STRATEGY_MODIFIED,
          entityType: 'StrategyConfig',
          entityId: 'e-1',
          timestamp,
          integrity
        },
        null
      );

      const entry = {
        id: 'a-1',
        eventType: AuditEventType.STRATEGY_MODIFIED,
        entityType: 'StrategyConfig',
        entityId: 'e-1',
        userId: 'tampered-user', // tampered
        timestamp,
        integrity,
        chainHash,
        beforeState: undefined,
        afterState: undefined,
        metadata: undefined
      } as unknown as AuditLog;

      const result = service.verifyAuditChain([entry]);

      expect(result.valid).toBe(false);
      expect(result.integrityFailures).toContain('a-1');
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
