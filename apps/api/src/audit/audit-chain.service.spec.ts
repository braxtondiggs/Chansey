import { AuditEventType } from '@chansey/api-interfaces';

import { AuditChainService } from './audit-chain.service';
import { type AuditLog } from './entities/audit-log.entity';

import { CryptoService } from '../common/crypto.service';

describe('AuditChainService', () => {
  let service: AuditChainService;
  let cryptoService: CryptoService;
  let mockRepo: any;

  beforeEach(() => {
    cryptoService = new CryptoService();

    mockRepo = {
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn()
    };

    service = new AuditChainService(mockRepo, cryptoService);
  });

  /** Build a valid audit entry with correct integrity + chain hash */
  function buildEntry(
    id: string,
    userId: string,
    previousChainHash: string | null,
    timestamp = new Date(),
    overrides: Partial<AuditLog> = {}
  ): AuditLog {
    const base = {
      eventType: AuditEventType.STRATEGY_MODIFIED,
      entityType: 'StrategyConfig',
      entityId: 'e-1',
      ...overrides
    };

    const integrity = cryptoService.generateAuditIntegrityHash({
      ...base,
      userId,
      timestamp
    });

    const chainHash = cryptoService.generateChainHash({ id, ...base, timestamp, integrity }, previousChainHash);

    return {
      id,
      ...base,
      userId,
      timestamp,
      integrity,
      chainHash,
      beforeState: undefined,
      afterState: undefined,
      metadata: undefined,
      ...overrides
    } as unknown as AuditLog;
  }

  describe('verifyAuditChain', () => {
    it('returns valid for empty entries', () => {
      const result = service.verifyAuditChain([]);

      expect(result).toEqual({
        valid: true,
        totalEntries: 0,
        verifiedEntries: 0,
        brokenChainAt: null,
        tamperedEntries: [],
        integrityFailures: []
      });
    });

    it('validates a single-entry chain', () => {
      const entry = buildEntry('a-1', 'u-1', null);

      const result = service.verifyAuditChain([entry]);

      expect(result.valid).toBe(true);
      expect(result.verifiedEntries).toBe(1);
      expect(result.totalEntries).toBe(1);
      expect(result.integrityFailures).toEqual([]);
      expect(result.tamperedEntries).toEqual([]);
    });

    it('validates a multi-entry chain with correct linkage', () => {
      const t1 = new Date('2025-01-01T00:00:00Z');
      const t2 = new Date('2025-01-01T01:00:00Z');
      const t3 = new Date('2025-01-01T02:00:00Z');

      const entry1 = buildEntry('a-1', 'u-1', null, t1);
      const entry2 = buildEntry('a-2', 'u-1', entry1.chainHash ?? null, t2);
      const entry3 = buildEntry('a-3', 'u-1', entry2.chainHash ?? null, t3);

      const result = service.verifyAuditChain([entry1, entry2, entry3]);

      expect(result.valid).toBe(true);
      expect(result.verifiedEntries).toBe(3);
      expect(result.brokenChainAt).toBeNull();
    });

    it('detects integrity failure when userId is tampered', () => {
      const entry = buildEntry('a-1', 'u-1', null);
      // Tamper the userId after building — integrity hash no longer matches
      (entry as any).userId = 'tampered-user';

      const result = service.verifyAuditChain([entry]);

      expect(result.valid).toBe(false);
      expect(result.integrityFailures).toContain('a-1');
    });

    it('detects broken chain when chainHash is tampered', () => {
      const t1 = new Date('2025-01-01T00:00:00Z');
      const t2 = new Date('2025-01-01T01:00:00Z');

      const entry1 = buildEntry('a-1', 'u-1', null, t1);
      const entry2 = buildEntry('a-2', 'u-1', entry1.chainHash ?? null, t2);
      // Tamper chainHash on second entry
      (entry2 as any).chainHash = 'invalid-hash';

      const result = service.verifyAuditChain([entry1, entry2]);

      expect(result.valid).toBe(false);
      expect(result.brokenChainAt).toBe(1);
      expect(result.tamperedEntries).toContain('a-2');
    });

    it('deduplicates entries that fail both chain and integrity checks', () => {
      const entry = buildEntry('a-1', 'u-1', null);
      // Tamper both userId (integrity) and chainHash (chain linkage)
      (entry as any).userId = 'tampered';
      (entry as any).chainHash = 'bad-hash';

      const result = service.verifyAuditChain([entry]);

      expect(result.valid).toBe(false);
      expect(result.integrityFailures).toContain('a-1');
      // tamperedEntries merges chain + integrity via Set — should not duplicate
      const occurrences = result.tamperedEntries.filter((id) => id === 'a-1');
      expect(occurrences).toHaveLength(1);
    });
  });

  describe('verifyChainIntegrity', () => {
    it('returns true for entry without chainHash (legacy entry)', () => {
      const entry = buildEntry('a-1', 'u-1', null);
      (entry as any).chainHash = undefined;

      const result = service.verifyChainIntegrity(entry, null);

      expect(result).toBe(true);
    });

    it('validates chain link against previous entry', () => {
      const t1 = new Date('2025-01-01T00:00:00Z');
      const t2 = new Date('2025-01-01T01:00:00Z');

      const entry1 = buildEntry('a-1', 'u-1', null, t1);
      const entry2 = buildEntry('a-2', 'u-1', entry1.chainHash ?? null, t2);

      const result = service.verifyChainIntegrity(entry2, entry1);

      expect(result).toBe(true);
    });

    it('rejects entry with mismatched chainHash', () => {
      const entry = buildEntry('a-1', 'u-1', null);
      (entry as any).chainHash = 'wrong-hash';

      const result = service.verifyChainIntegrity(entry, null);

      expect(result).toBe(false);
    });
  });

  describe('verifyEntityAuditChain', () => {
    it('fetches entries in chronological order and verifies', async () => {
      mockRepo.find.mockResolvedValueOnce([]);

      const result = await service.verifyEntityAuditChain('StrategyConfig', 'sc-1');

      expect(mockRepo.find).toHaveBeenCalledWith({
        where: { entityType: 'StrategyConfig', entityId: 'sc-1' },
        order: { timestamp: 'ASC' }
      });
      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(0);
    });
  });

  describe('verifyGlobalAuditChain', () => {
    it('queries with default pagination and returns result', async () => {
      mockRepo.find.mockResolvedValueOnce([]);

      const result = await service.verifyGlobalAuditChain();

      expect(mockRepo.find).toHaveBeenCalledWith({
        order: { timestamp: 'ASC' },
        take: 1000,
        skip: 0
      });
      expect(result.valid).toBe(true);
    });

    it('passes custom limit and offset', async () => {
      mockRepo.find.mockResolvedValueOnce([]);

      await service.verifyGlobalAuditChain(500, 100);

      expect(mockRepo.find).toHaveBeenCalledWith({
        order: { timestamp: 'ASC' },
        take: 500,
        skip: 100
      });
    });

    it('logs error when chain is invalid', async () => {
      const entry = buildEntry('a-1', 'u-1', null);
      (entry as any).userId = 'tampered';
      mockRepo.find.mockResolvedValueOnce([entry]);

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      const result = await service.verifyGlobalAuditChain();

      expect(result.valid).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Audit chain integrity breach detected'));
    });
  });

  describe('verifyAuditChainByDateRange', () => {
    it('queries with date range via QueryBuilder', async () => {
      const getMany = jest.fn().mockResolvedValue([]);
      const orderBy = jest.fn().mockReturnValue({ getMany });
      const andWhere = jest.fn().mockReturnValue({ orderBy });
      const where = jest.fn().mockReturnValue({ andWhere });
      mockRepo.createQueryBuilder.mockReturnValue({ where });

      const start = new Date('2025-01-01');
      const end = new Date('2025-01-31');

      const result = await service.verifyAuditChainByDateRange(start, end);

      expect(mockRepo.createQueryBuilder).toHaveBeenCalledWith('audit');
      expect(where).toHaveBeenCalledWith('audit.timestamp >= :startDate', { startDate: start });
      expect(andWhere).toHaveBeenCalledWith('audit.timestamp <= :endDate', { endDate: end });
      expect(orderBy).toHaveBeenCalledWith('audit.timestamp', 'ASC');
      expect(result.valid).toBe(true);
    });
  });

  describe('runScheduledIntegrityCheck', () => {
    it('delegates to verifyAuditChainByDateRange with computed date range', async () => {
      const getMany = jest.fn().mockResolvedValue([]);
      const orderBy = jest.fn().mockReturnValue({ getMany });
      const andWhere = jest.fn().mockReturnValue({ orderBy });
      const where = jest.fn().mockReturnValue({ andWhere });
      mockRepo.createQueryBuilder.mockReturnValue({ where });

      const result = await service.runScheduledIntegrityCheck(48);
      const after = Date.now();

      expect(result.valid).toBe(true);
      // Verify the start date is approximately 48 hours before now
      const startDateArg: Date = where.mock.calls[0][1].startDate;
      const hoursDiff = (after - startDateArg.getTime()) / (60 * 60 * 1000);
      expect(hoursDiff).toBeGreaterThanOrEqual(47.9);
      expect(hoursDiff).toBeLessThanOrEqual(48.1);
    });

    it('logs critical error when tampering is detected', async () => {
      const entry = buildEntry('a-1', 'u-1', null);
      (entry as any).userId = 'tampered';

      const getMany = jest.fn().mockResolvedValue([entry]);
      const orderBy = jest.fn().mockReturnValue({ getMany });
      const andWhere = jest.fn().mockReturnValue({ orderBy });
      const where = jest.fn().mockReturnValue({ andWhere });
      mockRepo.createQueryBuilder.mockReturnValue({ where });

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      const result = await service.runScheduledIntegrityCheck();

      expect(result.valid).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('CRITICAL: Audit log tampering detected'));
    });
  });
});
