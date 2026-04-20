import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';

import { DeploymentRecommendation, NotificationEventType, PipelineStage } from '@chansey/api-interfaces';

import {
  DIGEST_DEBOUNCE_MS,
  type DigestEntry,
  PIPELINE_DIGEST_JOB_NAME,
  PIPELINE_DIGEST_QUEUE,
  PipelineNotificationDigestService
} from './pipeline-notification-digest.service';

import { NOTIFICATION_REDIS } from '../notification-redis.provider';
import { NotificationService } from '../notification.service';

function makeEntry(overrides: Partial<DigestEntry> = {}): DigestEntry {
  return {
    pipelineId: 'pl-1',
    userId: 'user-1',
    strategyName: 'Alpha RSI',
    subType: 'started',
    at: '2026-04-20T00:00:00.000Z',
    ...overrides
  };
}

interface MockQueue {
  add: jest.Mock;
  getJob: jest.Mock;
}

interface MockJob {
  id: string;
  changeDelay: jest.Mock;
  remove: jest.Mock;
  moveToFailed: jest.Mock;
  opts?: { attempts?: number };
}

describe('PipelineNotificationDigestService', () => {
  let service: PipelineNotificationDigestService;
  let queue: MockQueue;
  let redis: { multi: jest.Mock };
  let multiChain: { rpush: jest.Mock; pexpire: jest.Mock; lrange: jest.Mock; del: jest.Mock; exec: jest.Mock };
  let notificationService: { send: jest.Mock };

  beforeEach(async () => {
    multiChain = {
      rpush: jest.fn().mockReturnThis(),
      pexpire: jest.fn().mockReturnThis(),
      lrange: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, []]])
    };

    redis = { multi: jest.fn().mockReturnValue(multiChain) };
    queue = {
      add: jest.fn().mockResolvedValue({ id: 'job-1' }),
      getJob: jest.fn().mockResolvedValue(null)
    };
    notificationService = { send: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        PipelineNotificationDigestService,
        { provide: getQueueToken(PIPELINE_DIGEST_QUEUE), useValue: queue },
        { provide: NOTIFICATION_REDIS, useValue: redis },
        { provide: NotificationService, useValue: notificationService }
      ]
    }).compile();

    service = module.get(PipelineNotificationDigestService);
  });

  describe('enqueue', () => {
    it('buffers entry and schedules a new debounce job when none exists', async () => {
      const entry = makeEntry();
      await service.enqueue('started', entry);

      expect(multiChain.rpush).toHaveBeenCalledWith('notif:pl-digest:pending:user-1:started', JSON.stringify(entry));
      expect(multiChain.pexpire).toHaveBeenCalledWith(
        'notif:pl-digest:pending:user-1:started',
        DIGEST_DEBOUNCE_MS.started + 60 * 60 * 1000
      );
      expect(queue.add).toHaveBeenCalledWith(
        PIPELINE_DIGEST_JOB_NAME,
        { userId: 'user-1', bucket: 'started' },
        expect.objectContaining({
          jobId: 'pl-digest:user-1:started',
          delay: DIGEST_DEBOUNCE_MS.started,
          attempts: 3
        })
      );
    });

    it('extends debounce via changeDelay when a pending job already exists', async () => {
      const existing: MockJob = {
        id: 'pl-digest:user-1:started',
        changeDelay: jest.fn().mockResolvedValue(undefined),
        remove: jest.fn(),
        moveToFailed: jest.fn()
      };
      queue.getJob.mockResolvedValue(existing);

      await service.enqueue('started', makeEntry());

      expect(existing.changeDelay).toHaveBeenCalledWith(DIGEST_DEBOUNCE_MS.started);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('force-removes and re-adds when changeDelay fails', async () => {
      const existing: MockJob = {
        id: 'pl-digest:user-1:started',
        changeDelay: jest.fn().mockRejectedValue(new Error('job already active')),
        remove: jest.fn().mockResolvedValue(undefined),
        moveToFailed: jest.fn().mockResolvedValue(undefined),
        opts: { attempts: 1 }
      };
      queue.getJob.mockResolvedValue(existing);

      await service.enqueue('started', makeEntry());

      expect(existing.changeDelay).toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalledWith(
        PIPELINE_DIGEST_JOB_NAME,
        { userId: 'user-1', bucket: 'started' },
        expect.objectContaining({ jobId: 'pl-digest:user-1:started', delay: DIGEST_DEBOUNCE_MS.started })
      );
    });

    it('uses bucket-specific debounce delay for stage bucket', async () => {
      await service.enqueue('stage', makeEntry({ subType: 'stage' }));
      expect(queue.add).toHaveBeenCalledWith(
        PIPELINE_DIGEST_JOB_NAME,
        expect.any(Object),
        expect.objectContaining({ delay: DIGEST_DEBOUNCE_MS.stage })
      );
    });

    it('uses bucket-specific debounce delay for terminal bucket', async () => {
      await service.enqueue('terminal', makeEntry({ subType: 'completed' }));
      expect(queue.add).toHaveBeenCalledWith(
        PIPELINE_DIGEST_JOB_NAME,
        expect.any(Object),
        expect.objectContaining({ delay: DIGEST_DEBOUNCE_MS.terminal })
      );
    });
  });

  describe('flush', () => {
    function stubDrain(entries: DigestEntry[]): void {
      const raw = entries.map((e) => JSON.stringify(e));
      multiChain.exec.mockResolvedValue([
        [null, raw],
        [null, 1]
      ]);
    }

    it('no-ops when the pending list is empty', async () => {
      multiChain.exec.mockResolvedValue([
        [null, []],
        [null, 0]
      ]);

      await service.flush('user-1', 'started');

      expect(notificationService.send).not.toHaveBeenCalled();
    });

    it('emits single-pipeline started wording for one entry', async () => {
      stubDrain([makeEntry({ subType: 'started', strategyName: 'Alpha RSI' })]);

      await service.flush('user-1', 'started');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_STARTED,
        'We started building a new strategy',
        expect.stringContaining('being trained and tested'),
        'info',
        expect.objectContaining({ strategyName: 'Alpha RSI' })
      );
    });

    it('emits pluralized started wording with listed names for many entries', async () => {
      stubDrain([
        makeEntry({ pipelineId: 'p1', strategyName: 'Alpha' }),
        makeEntry({ pipelineId: 'p2', strategyName: 'Beta' }),
        makeEntry({ pipelineId: 'p3', strategyName: 'Gamma' }),
        makeEntry({ pipelineId: 'p4', strategyName: 'Delta' })
      ]);

      await service.flush('user-1', 'started');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_STARTED,
        'We started building 4 new strategies',
        expect.stringContaining('Alpha, Beta, Gamma…'),
        'info',
        expect.objectContaining({ count: 4 })
      );
    });

    it('emits collapsed stage wording when all entries share the same transition', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'stage',
          previousStage: PipelineStage.OPTIMIZE,
          newStage: PipelineStage.HISTORICAL
        }),
        makeEntry({
          pipelineId: 'p2',
          subType: 'stage',
          previousStage: PipelineStage.OPTIMIZE,
          newStage: PipelineStage.HISTORICAL
        })
      ]);

      await service.flush('user-1', 'stage');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_STAGE_COMPLETED,
        '2 strategies: training complete',
        'All moving on to: Testing against history.',
        'info',
        expect.any(Object)
      );
    });

    it('groups heterogeneous stage transitions into prev→next clauses', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'stage',
          previousStage: PipelineStage.OPTIMIZE,
          newStage: PipelineStage.HISTORICAL
        }),
        makeEntry({
          pipelineId: 'p2',
          subType: 'stage',
          previousStage: PipelineStage.OPTIMIZE,
          newStage: PipelineStage.HISTORICAL
        }),
        makeEntry({
          pipelineId: 'p3',
          subType: 'stage',
          previousStage: PipelineStage.HISTORICAL,
          newStage: PipelineStage.LIVE_REPLAY
        })
      ]);

      await service.flush('user-1', 'stage');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_STAGE_COMPLETED,
        '3 strategies making progress',
        expect.stringContaining('2 × training complete → Testing against history'),
        'info',
        expect.any(Object)
      );
      const [, , , body] = notificationService.send.mock.calls[0];
      expect(body).toContain('1 × historical testing complete → Replaying recent market data');
    });

    it('terminal all-success emits PIPELINE_COMPLETED info', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY
        }),
        makeEntry({
          pipelineId: 'p2',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY
        })
      ]);

      await service.flush('user-1', 'terminal');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_COMPLETED,
        '2 new strategies are ready for live trading',
        expect.stringContaining('passed every check'),
        'info',
        expect.objectContaining({ counts: expect.objectContaining({ success: 2 }) })
      );
    });

    it('terminal all-rejected-or-failed emits PIPELINE_REJECTED medium', async () => {
      stubDrain([
        makeEntry({ pipelineId: 'p1', subType: 'rejected', reason: 'bad sharpe' }),
        makeEntry({ pipelineId: 'p2', subType: 'failed', reason: 'exception' })
      ]);

      await service.flush('user-1', 'terminal');

      const call = notificationService.send.mock.calls[0];
      expect(call[1]).toBe(NotificationEventType.PIPELINE_REJECTED);
      expect(call[2]).toBe('2 strategies finished with issues');
      expect(call[3]).toContain(`1 didn't pass review`);
      expect(call[3]).toContain(`1 couldn't finish building`);
      expect(call[4]).toBe('medium');
      expect(call[5]).toEqual(
        expect.objectContaining({ counts: expect.objectContaining({ rejected: 1, failed: 1, success: 0 }) })
      );
    });

    it('terminal mixed success + failure still emits PIPELINE_COMPLETED info', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY
        }),
        makeEntry({ pipelineId: 'p2', subType: 'rejected', reason: 'x' }),
        makeEntry({ pipelineId: 'p3', subType: 'failed', reason: 'y' })
      ]);

      await service.flush('user-1', 'terminal');

      const call = notificationService.send.mock.calls[0];
      expect(call[1]).toBe(NotificationEventType.PIPELINE_COMPLETED);
      expect(call[4]).toBe('info');
      expect(call[3]).toContain('1 ready for live trading');
      expect(call[3]).toContain(`1 didn't pass review`);
      expect(call[3]).toContain(`1 couldn't finish building`);
    });

    it('terminal all-inconclusive emits PIPELINE_REJECTED low', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.INCONCLUSIVE_RETRY
        }),
        makeEntry({
          pipelineId: 'p2',
          subType: 'completed',
          recommendation: DeploymentRecommendation.INCONCLUSIVE_RETRY
        })
      ]);

      await service.flush('user-1', 'terminal');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_REJECTED,
        '2 strategies: not enough trading opportunities',
        expect.stringContaining('retry with fresh parameters'),
        'low',
        expect.objectContaining({
          counts: expect.objectContaining({ inconclusive: 2, success: 0, rejected: 0, failed: 0 })
        })
      );
    });

    it('dedupes duplicate pipelineIds and keeps the latest entry', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DO_NOT_DEPLOY,
          at: '2026-04-20T00:00:00.000Z'
        }),
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY,
          at: '2026-04-20T00:01:00.000Z'
        })
      ]);

      await service.flush('user-1', 'terminal');

      // Latest for p1 is DEPLOY → single-pipeline success wording
      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_COMPLETED,
        'A new strategy is ready for live trading',
        expect.any(String),
        'info',
        expect.any(Object)
      );
    });

    it('dedupes by timestamp when entries arrive out of order', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY,
          at: '2026-04-20T00:01:00.000Z'
        }),
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DO_NOT_DEPLOY,
          at: '2026-04-20T00:00:00.000Z'
        })
      ]);

      await service.flush('user-1', 'terminal');

      // Later timestamp is DEPLOY despite arriving first → single-pipeline success wording
      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_COMPLETED,
        'A new strategy is ready for live trading',
        expect.any(String),
        'info',
        expect.any(Object)
      );
    });

    it('terminal all-NEEDS_REVIEW treats entries as success', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.NEEDS_REVIEW
        }),
        makeEntry({
          pipelineId: 'p2',
          subType: 'completed',
          recommendation: DeploymentRecommendation.NEEDS_REVIEW
        })
      ]);

      await service.flush('user-1', 'terminal');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_COMPLETED,
        '2 new strategies are ready for live trading',
        expect.stringContaining('passed every check'),
        'info',
        expect.objectContaining({
          counts: expect.objectContaining({ success: 2, rejected: 0, failed: 0, inconclusive: 0 })
        })
      );
    });

    it('terminal mixed DEPLOY + NEEDS_REVIEW counts both as success', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY
        }),
        makeEntry({
          pipelineId: 'p2',
          subType: 'completed',
          recommendation: DeploymentRecommendation.NEEDS_REVIEW
        })
      ]);

      await service.flush('user-1', 'terminal');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_COMPLETED,
        '2 new strategies are ready for live trading',
        expect.stringContaining('passed every check'),
        'info',
        expect.objectContaining({
          counts: expect.objectContaining({ success: 2, rejected: 0, failed: 0, inconclusive: 0 })
        })
      );
    });

    it('single-pipeline terminal NEEDS_REVIEW falls through to success wording', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.NEEDS_REVIEW,
          strategyName: 'SoloBot'
        })
      ]);

      await service.flush('user-1', 'terminal');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_COMPLETED,
        'A new strategy is ready for live trading',
        expect.stringContaining('being activated on your account'),
        'info',
        expect.objectContaining({ strategyName: 'SoloBot' })
      );
    });

    it('single-pipeline terminal completed DEPLOY reuses per-recommendation wording', async () => {
      stubDrain([
        makeEntry({
          pipelineId: 'p1',
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY,
          strategyName: 'SoloBot'
        })
      ]);

      await service.flush('user-1', 'terminal');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_COMPLETED,
        'A new strategy is ready for live trading',
        expect.stringContaining('being activated on your account'),
        'info',
        expect.objectContaining({ strategyName: 'SoloBot' })
      );
    });

    it('single-pipeline terminal failed keeps original wording', async () => {
      stubDrain([makeEntry({ pipelineId: 'p1', subType: 'failed', reason: 'crash', strategyName: 'SoloBot' })]);

      await service.flush('user-1', 'terminal');

      expect(notificationService.send).toHaveBeenCalledWith(
        'user-1',
        NotificationEventType.PIPELINE_REJECTED,
        `A strategy couldn't finish building`,
        expect.stringContaining('try again on the next cycle'),
        'medium',
        expect.objectContaining({ reason: 'crash' })
      );
    });
  });
});
