import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingCleanupService } from './paper-trading-cleanup.service';
import { PaperTradingService } from './paper-trading.service';

import { Pipeline } from '../../pipeline/entities/pipeline.entity';
import { PipelineStatus } from '../../pipeline/interfaces';

describe('PaperTradingCleanupService', () => {
  let service: PaperTradingCleanupService;
  let sessionRepository: any;
  let pipelineRepository: any;
  let paperTradingService: any;

  /**
   * Build a fake session row with the relations the service expects.
   */
  const makeSession = (overrides: Partial<any>) => ({
    id: overrides.id ?? `s-${Math.random()}`,
    status: PaperTradingStatus.ACTIVE,
    createdAt: overrides.createdAt ?? new Date(),
    pipelineId: overrides.pipelineId,
    user: { id: overrides.userId ?? 'user-1' },
    algorithm: { id: overrides.algorithmId ?? 'algo-1' }
  });

  /**
   * The cleanup query loads ACTIVE/PAUSED sessions ordered by user/algorithm/createdAt.
   * Use this helper to seed the query builder result.
   */
  const mockCleanupQuery = (rows: any[]) => {
    const qb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows)
    };
    sessionRepository.createQueryBuilder.mockReturnValue(qb);
    return qb;
  };

  beforeEach(async () => {
    sessionRepository = {
      createQueryBuilder: jest.fn()
    };

    pipelineRepository = {
      update: jest.fn().mockResolvedValue(undefined)
    };

    paperTradingService = {
      stop: jest.fn().mockResolvedValue({})
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaperTradingCleanupService,
        { provide: getRepositoryToken(PaperTradingSession), useValue: sessionRepository },
        { provide: getRepositoryToken(Pipeline), useValue: pipelineRepository },
        { provide: PaperTradingService, useValue: paperTradingService }
      ]
    }).compile();

    service = module.get<PaperTradingCleanupService>(PaperTradingCleanupService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('cleanupDuplicateSessions', () => {
    it('keeps the oldest session per (user, algorithm) group and stops the rest', async () => {
      // All three share user-1 + algo-1, so they form one group of three
      const oldest = makeSession({
        id: 'old',
        userId: 'user-1',
        algorithmId: 'algo-1',
        createdAt: new Date('2026-01-01'),
        pipelineId: 'p-old'
      });
      const middle = makeSession({
        id: 'mid',
        userId: 'user-1',
        algorithmId: 'algo-1',
        createdAt: new Date('2026-02-01'),
        pipelineId: 'p-mid'
      });
      const newest = makeSession({
        id: 'new',
        userId: 'user-1',
        algorithmId: 'algo-1',
        createdAt: new Date('2026-03-01'),
        pipelineId: 'p-new'
      });
      mockCleanupQuery([oldest, middle, newest]);

      const result = await service.cleanupDuplicateSessions(false);

      expect(result).toEqual({
        scanned: 3,
        kept: 1,
        stopped: [
          { sessionId: 'mid', pipelineId: 'p-mid' },
          { sessionId: 'new', pipelineId: 'p-new' }
        ],
        dryRun: false
      });
      expect(paperTradingService.stop).toHaveBeenCalledTimes(2);
      expect(paperTradingService.stop).toHaveBeenCalledWith(
        'mid',
        expect.objectContaining({ id: 'user-1' }),
        'duplicate-cleanup'
      );
      expect(paperTradingService.stop).toHaveBeenCalledWith(
        'new',
        expect.objectContaining({ id: 'user-1' }),
        'duplicate-cleanup'
      );

      // Linked pipelines cancelled — oldest is preserved, only duplicates touched
      expect(pipelineRepository.update).toHaveBeenCalledTimes(2);
      expect(pipelineRepository.update).toHaveBeenCalledWith(
        { id: 'p-mid' },
        expect.objectContaining({ status: PipelineStatus.CANCELLED, failureReason: expect.any(String) })
      );
      expect(pipelineRepository.update).toHaveBeenCalledWith(
        { id: 'p-new' },
        expect.objectContaining({ status: PipelineStatus.CANCELLED })
      );
      expect(pipelineRepository.update).not.toHaveBeenCalledWith({ id: 'p-old' }, expect.anything());
    });

    it('stops duplicate without a pipelineId without touching pipelineRepository for it', async () => {
      const oldest = makeSession({ id: 'old', createdAt: new Date('2026-01-01'), pipelineId: 'p-old' });
      const orphan = makeSession({ id: 'orphan', createdAt: new Date('2026-02-01') }); // no pipelineId
      mockCleanupQuery([oldest, orphan]);

      const result = await service.cleanupDuplicateSessions(false);

      expect(result.stopped).toEqual([{ sessionId: 'orphan', pipelineId: undefined }]);
      expect(paperTradingService.stop).toHaveBeenCalledWith('orphan', expect.anything(), 'duplicate-cleanup');
      // Only the duplicate's pipeline would ever be updated, and it has none, so update() must not fire
      expect(pipelineRepository.update).not.toHaveBeenCalled();
    });

    it('logs and skips a duplicate when stop() throws, continuing with the rest of the group', async () => {
      const loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const oldest = makeSession({ id: 'old', createdAt: new Date('2026-01-01'), pipelineId: 'p-old' });
      const failing = makeSession({ id: 'fail', createdAt: new Date('2026-02-01'), pipelineId: 'p-fail' });
      const surviving = makeSession({ id: 'ok', createdAt: new Date('2026-03-01'), pipelineId: 'p-ok' });
      mockCleanupQuery([oldest, failing, surviving]);

      paperTradingService.stop.mockImplementation(async (sessionId: string) => {
        if (sessionId === 'fail') throw new Error('boom');
        return {};
      });

      const result = await service.cleanupDuplicateSessions(false);

      // Failed duplicate is NOT recorded as stopped, but the next duplicate still proceeds
      expect(result.scanned).toBe(3);
      expect(result.kept).toBe(1);
      expect(result.stopped).toEqual([{ sessionId: 'ok', pipelineId: 'p-ok' }]);
      expect(paperTradingService.stop).toHaveBeenCalledTimes(2);
      // Failed duplicate's pipeline never gets cancelled
      expect(pipelineRepository.update).toHaveBeenCalledTimes(1);
      expect(pipelineRepository.update).toHaveBeenCalledWith({ id: 'p-ok' }, expect.anything());
      expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining('fail'));

      loggerErrorSpy.mockRestore();
    });

    it('does not call stop() or pipeline update in dryRun mode', async () => {
      const oldest = makeSession({ id: 'old', createdAt: new Date('2026-01-01') });
      const newest = makeSession({ id: 'new', createdAt: new Date('2026-02-01'), pipelineId: 'p-new' });
      mockCleanupQuery([oldest, newest]);

      const result = await service.cleanupDuplicateSessions(true);

      expect(result.scanned).toBe(2);
      expect(result.kept).toBe(1);
      expect(result.stopped).toEqual([{ sessionId: 'new', pipelineId: 'p-new' }]);
      expect(paperTradingService.stop).not.toHaveBeenCalled();
      expect(pipelineRepository.update).not.toHaveBeenCalled();
    });

    it('does not stop sessions in groups of size 1', async () => {
      const lonelyA = makeSession({ id: 'A', userId: 'user-1', algorithmId: 'algo-1' });
      const lonelyB = makeSession({ id: 'B', userId: 'user-2', algorithmId: 'algo-1' });
      const lonelyC = makeSession({ id: 'C', userId: 'user-1', algorithmId: 'algo-2' });
      mockCleanupQuery([lonelyA, lonelyB, lonelyC]);

      const result = await service.cleanupDuplicateSessions(false);

      expect(result.scanned).toBe(3);
      expect(result.kept).toBe(3);
      expect(result.stopped).toHaveLength(0);
      expect(paperTradingService.stop).not.toHaveBeenCalled();
    });

    it('returns empty result when no active/paused sessions exist', async () => {
      mockCleanupQuery([]);

      const result = await service.cleanupDuplicateSessions(false);

      expect(result).toEqual({ scanned: 0, kept: 0, stopped: [], dryRun: false });
    });
  });
});
