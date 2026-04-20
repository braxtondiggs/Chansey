import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DeploymentRecommendation, PipelineStage, PipelineStatus } from '@chansey/api-interfaces';

import { PipelineNotificationListener } from './pipeline-notification.listener';

import { Pipeline } from '../../pipeline/entities/pipeline.entity';
import type { PipelineStageTransitionEvent, PipelineStatusChangeEvent } from '../../pipeline/interfaces';
import { PipelineNotificationDigestService } from '../services/pipeline-notification-digest.service';

const TIMESTAMP = '2026-04-20T00:00:00.000Z';

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: 'pl-1',
    name: 'Fallback Name',
    user: { id: 'user-1' },
    strategyConfig: { name: 'Alpha RSI' },
    ...overrides
  } as unknown as Pipeline;
}

function runningPayload(overrides: Partial<PipelineStatusChangeEvent> = {}): PipelineStatusChangeEvent {
  return {
    pipelineId: 'pl-1',
    previousStatus: PipelineStatus.PENDING,
    newStatus: PipelineStatus.RUNNING,
    timestamp: TIMESTAMP,
    ...overrides
  };
}

describe('PipelineNotificationListener', () => {
  let listener: PipelineNotificationListener;
  let digest: { enqueue: jest.Mock };
  let pipelineRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    digest = { enqueue: jest.fn().mockResolvedValue(undefined) };
    pipelineRepo = { findOne: jest.fn().mockResolvedValue(makePipeline()) };

    const module = await Test.createTestingModule({
      providers: [
        PipelineNotificationListener,
        { provide: PipelineNotificationDigestService, useValue: digest },
        { provide: getRepositoryToken(Pipeline), useValue: pipelineRepo }
      ]
    }).compile();

    listener = module.get(PipelineNotificationListener);
  });

  describe('handleStatusChange', () => {
    it('enqueues started entry for PENDING→RUNNING', async () => {
      await listener.handleStatusChange(runningPayload());

      expect(digest.enqueue).toHaveBeenCalledWith(
        'started',
        expect.objectContaining({
          pipelineId: 'pl-1',
          userId: 'user-1',
          strategyName: 'Alpha RSI',
          subType: 'started',
          at: TIMESTAMP
        })
      );
    });

    it('ignores transitions where newStatus is not RUNNING', async () => {
      await listener.handleStatusChange(
        runningPayload({ previousStatus: PipelineStatus.RUNNING, newStatus: PipelineStatus.COMPLETED })
      );
      expect(digest.enqueue).not.toHaveBeenCalled();
    });

    it('ignores RUNNING transitions when previousStatus is not PENDING', async () => {
      await listener.handleStatusChange(runningPayload({ previousStatus: PipelineStatus.RUNNING }));
      expect(digest.enqueue).not.toHaveBeenCalled();
    });

    it('falls back to pipeline.name when strategyConfig is missing', async () => {
      pipelineRepo.findOne.mockResolvedValueOnce(
        makePipeline({ strategyConfig: undefined, name: 'My Pipeline' } as Partial<Pipeline>)
      );

      await listener.handleStatusChange(runningPayload());

      expect(digest.enqueue).toHaveBeenCalledWith('started', expect.objectContaining({ strategyName: 'My Pipeline' }));
    });

    it('no-ops when pipeline is missing', async () => {
      pipelineRepo.findOne.mockResolvedValueOnce(null);

      await listener.handleStatusChange(runningPayload());

      expect(digest.enqueue).not.toHaveBeenCalled();
    });

    it('no-ops when pipeline has no user relation', async () => {
      pipelineRepo.findOne.mockResolvedValueOnce(makePipeline({ user: undefined } as Partial<Pipeline>));

      await listener.handleStatusChange(runningPayload());

      expect(digest.enqueue).not.toHaveBeenCalled();
    });

    it('uses current time when payload omits timestamp', async () => {
      await listener.handleStatusChange(runningPayload({ timestamp: undefined as unknown as string }));

      expect(digest.enqueue).toHaveBeenCalledWith(
        'started',
        expect.objectContaining({ at: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/) })
      );
    });

    it('does not throw when digest enqueue fails', async () => {
      digest.enqueue.mockRejectedValue(new Error('redis down'));

      await expect(listener.handleStatusChange(runningPayload())).resolves.toBeUndefined();
    });
  });

  describe('handleStageTransition', () => {
    it('enqueues stage entry with prev/next stages', async () => {
      const payload: PipelineStageTransitionEvent = {
        pipelineId: 'pl-1',
        previousStage: PipelineStage.OPTIMIZE,
        newStage: PipelineStage.HISTORICAL,
        timestamp: TIMESTAMP
      };

      await listener.handleStageTransition(payload);

      expect(digest.enqueue).toHaveBeenCalledWith(
        'stage',
        expect.objectContaining({
          pipelineId: 'pl-1',
          subType: 'stage',
          previousStage: PipelineStage.OPTIMIZE,
          newStage: PipelineStage.HISTORICAL
        })
      );
    });

    it('skips transitions into COMPLETED', async () => {
      await listener.handleStageTransition({
        pipelineId: 'pl-1',
        previousStage: PipelineStage.PAPER_TRADE,
        newStage: PipelineStage.COMPLETED,
        timestamp: TIMESTAMP
      });

      expect(digest.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('handleCompleted', () => {
    it('enqueues terminal entry with recommendation payload', async () => {
      await listener.handleCompleted({
        pipelineId: 'pl-1',
        recommendation: DeploymentRecommendation.DEPLOY,
        timestamp: TIMESTAMP
      });

      expect(digest.enqueue).toHaveBeenCalledWith(
        'terminal',
        expect.objectContaining({
          subType: 'completed',
          recommendation: DeploymentRecommendation.DEPLOY
        })
      );
    });

    it('propagates the inconclusive flag', async () => {
      await listener.handleCompleted({
        pipelineId: 'pl-1',
        recommendation: DeploymentRecommendation.DO_NOT_DEPLOY,
        inconclusive: true,
        timestamp: TIMESTAMP
      });

      expect(digest.enqueue).toHaveBeenCalledWith('terminal', expect.objectContaining({ inconclusive: true }));
    });

    it('prefers pipeline.failureReason over payload reason', async () => {
      pipelineRepo.findOne.mockResolvedValueOnce(
        makePipeline({ failureReason: 'db-level reason' } as Partial<Pipeline>)
      );

      await listener.handleCompleted({
        pipelineId: 'pl-1',
        recommendation: DeploymentRecommendation.DO_NOT_DEPLOY,
        reason: 'payload reason',
        timestamp: TIMESTAMP
      });

      expect(digest.enqueue).toHaveBeenCalledWith('terminal', expect.objectContaining({ reason: 'db-level reason' }));
    });
  });

  describe('handleFailed', () => {
    it('enqueues terminal entry with failed subType', async () => {
      await listener.handleFailed({
        pipelineId: 'pl-1',
        reason: 'crashed',
        timestamp: TIMESTAMP
      });

      expect(digest.enqueue).toHaveBeenCalledWith(
        'terminal',
        expect.objectContaining({ subType: 'failed', reason: 'crashed' })
      );
    });
  });

  describe('handleRejected', () => {
    it('enqueues terminal entry with rejected subType', async () => {
      await listener.handleRejected({
        pipelineId: 'pl-1',
        reason: 'low score',
        timestamp: TIMESTAMP
      });

      expect(digest.enqueue).toHaveBeenCalledWith(
        'terminal',
        expect.objectContaining({ subType: 'rejected', reason: 'low score' })
      );
    });
  });
});
