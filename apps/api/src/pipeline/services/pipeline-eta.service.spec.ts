import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type Repository } from 'typeorm';

import { DeploymentRecommendation, PipelineStage, PipelineStatus } from '@chansey/api-interfaces';

import { PipelineEtaService } from './pipeline-eta.service';

import { PaperTradingSession } from '../../order/paper-trading/entities/paper-trading-session.entity';
import { Pipeline } from '../entities/pipeline.entity';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('PipelineEtaService', () => {
  let service: PipelineEtaService;
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;
  let paperTradingSessionRepository: jest.Mocked<Repository<PaperTradingSession>>;

  const makePipeline = (overrides: Partial<Pipeline> = {}): Pipeline =>
    ({
      id: 'pipeline-1',
      name: 'Test Pipeline',
      status: PipelineStatus.RUNNING,
      currentStage: PipelineStage.OPTIMIZE,
      createdAt: new Date('2026-04-01T00:00:00Z'),
      updatedAt: new Date(),
      user: { id: 'user-1', coinRisk: { level: 3 } },
      strategyConfig: { name: 'My Strategy' },
      ...overrides
    }) as unknown as Pipeline;

  const makeSession = (overrides: Partial<PaperTradingSession> = {}): PaperTradingSession =>
    ({
      id: 'session-1',
      totalTrades: 0,
      minTrades: 40,
      startedAt: new Date(),
      createdAt: new Date(),
      ...overrides
    }) as PaperTradingSession;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelineEtaService,
        {
          provide: getRepositoryToken(Pipeline),
          useValue: { findOne: jest.fn() }
        },
        {
          provide: getRepositoryToken(PaperTradingSession),
          useValue: { findOne: jest.fn() }
        }
      ]
    }).compile();

    service = module.get(PipelineEtaService);
    pipelineRepository = module.get(getRepositoryToken(Pipeline));
    paperTradingSessionRepository = module.get(getRepositoryToken(PaperTradingSession));
  });

  describe('getStatusForUser', () => {
    it('returns null when user has no pipeline', async () => {
      pipelineRepository.findOne.mockResolvedValue(null);
      const status = await service.getStatusForUser('user-1');
      expect(status).toBeNull();
    });

    it('returns null when pipeline completed more than PROMOTION_WINDOW_DAYS.max ago', async () => {
      pipelineRepository.findOne.mockResolvedValue(
        makePipeline({
          status: PipelineStatus.COMPLETED,
          currentStage: PipelineStage.COMPLETED,
          recommendation: DeploymentRecommendation.DEPLOY,
          completedAt: new Date(Date.now() - 10 * MS_PER_DAY)
        })
      );
      const status = await service.getStatusForUser('user-1');
      expect(status).toBeNull();
    });

    it('maps currentStage to stageIndex', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ currentStage: PipelineStage.LIVE_REPLAY }));
      const status = await service.getStatusForUser('user-1');
      expect(status?.stageIndex).toBe(2);
    });

    it('surfaces strategyName from strategyConfig', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline());
      const status = await service.getStatusForUser('user-1');
      expect(status?.strategyName).toBe('My Strategy');
    });

    it('falls back to pipeline.name when strategyConfig is missing', async () => {
      pipelineRepository.findOne.mockResolvedValue(
        makePipeline({ name: 'Fallback Name', strategyConfig: undefined } as unknown as Partial<Pipeline>)
      );
      const status = await service.getStatusForUser('user-1');
      expect(status?.strategyName).toBe('Fallback Name');
    });

    describe('rejection classification', () => {
      it('wasRejected=true when status FAILED, surfaces failureReason', async () => {
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({ status: PipelineStatus.FAILED, failureReason: 'optimization failed' })
        );
        const status = await service.getStatusForUser('user-1');
        expect(status?.wasRejected).toBe(true);
        expect(status?.rejectionReason).toBe('optimization failed');
      });

      it('wasRejected=true with generic reason when FAILED has no failureReason', async () => {
        pipelineRepository.findOne.mockResolvedValue(makePipeline({ status: PipelineStatus.FAILED }));
        const status = await service.getStatusForUser('user-1');
        expect(status?.wasRejected).toBe(true);
        expect(status?.rejectionReason).toBe('The strategy build could not finish.');
      });

      it('wasRejected=true with safety-review reason for DO_NOT_DEPLOY', async () => {
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({
            status: PipelineStatus.COMPLETED,
            recommendation: DeploymentRecommendation.DO_NOT_DEPLOY,
            completedAt: undefined
          })
        );
        const status = await service.getStatusForUser('user-1');
        expect(status?.wasRejected).toBe(true);
        expect(status?.isRetrying).toBe(false);
        expect(status?.rejectionReason).toBe('Your strategy did not pass the final safety review.');
      });

      it('isRetrying=true with explanatory reason for INCONCLUSIVE_RETRY', async () => {
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({
            status: PipelineStatus.COMPLETED,
            recommendation: DeploymentRecommendation.INCONCLUSIVE_RETRY,
            completedAt: undefined
          })
        );
        const status = await service.getStatusForUser('user-1');
        expect(status?.isRetrying).toBe(true);
        expect(status?.wasRejected).toBe(false);
        expect(status?.retryReason).toContain("couldn't find enough opportunities");
      });
    });

    describe('stall detection', () => {
      it('stalled when RUNNING and stageTransitionedAt older than 48h', async () => {
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({
            status: PipelineStatus.RUNNING,
            stageTransitionedAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
          })
        );
        const status = await service.getStatusForUser('user-1');
        expect(status?.isStalled).toBe(true);
      });

      it('not stalled when updatedAt is old but stageTransitionedAt is fresh', async () => {
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({
            status: PipelineStatus.RUNNING,
            updatedAt: new Date(Date.now() - 50 * 60 * 60 * 1000),
            stageTransitionedAt: new Date(Date.now() - 60 * 60 * 1000)
          })
        );
        const status = await service.getStatusForUser('user-1');
        expect(status?.isStalled).toBe(false);
      });

      it('falls back to startedAt when stageTransitionedAt is null', async () => {
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({
            status: PipelineStatus.RUNNING,
            stageTransitionedAt: null,
            startedAt: new Date(Date.now() - 50 * 60 * 60 * 1000)
          })
        );
        const status = await service.getStatusForUser('user-1');
        expect(status?.isStalled).toBe(true);
      });
    });
  });

  describe('computeRemaining', () => {
    it('OPTIMIZE yields cumulative range of all downstream stages', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ currentStage: PipelineStage.OPTIMIZE }));
      const status = await service.getStatusForUser('user-1');
      // OPTIMIZE (2-4) + HISTORICAL (1-1) + LIVE_REPLAY (1-1) + PAPER_TRADE (1-30) + promotion (1-2)
      expect(status?.minDaysRemaining).toBe(6);
      expect(status?.maxDaysRemaining).toBe(38);
    });

    it('HISTORICAL excludes OPTIMIZE from the range', async () => {
      pipelineRepository.findOne.mockResolvedValue(makePipeline({ currentStage: PipelineStage.HISTORICAL }));
      const status = await service.getStatusForUser('user-1');
      // HISTORICAL (1-1) + LIVE_REPLAY (1-1) + PAPER_TRADE (1-30) + promotion (1-2)
      expect(status?.minDaysRemaining).toBe(4);
      expect(status?.maxDaysRemaining).toBe(34);
    });

    describe('PAPER_TRADE stage', () => {
      it('projects from trade rate when session has data (5d/20 trades → ~5 days remaining)', async () => {
        const startedAt = new Date(Date.now() - 5 * MS_PER_DAY);
        paperTradingSessionRepository.findOne.mockResolvedValue(
          makeSession({ totalTrades: 20, startedAt, createdAt: startedAt })
        );
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({ currentStage: PipelineStage.PAPER_TRADE, paperTradingSessionId: 'session-1' })
        );
        const status = await service.getStatusForUser('user-1');
        // 4/day rate → 5 more days. ±20% band + promotion (1-2)
        expect(status?.minDaysRemaining).toBeGreaterThanOrEqual(5);
        expect(status?.maxDaysRemaining).toBeLessThanOrEqual(32);
        expect(status?.currentStageProgress).toEqual({ tradesCompleted: 20, tradesRequired: 40 });
      });

      it('returns near-zero range when trade target is hit', async () => {
        const startedAt = new Date(Date.now() - 3 * MS_PER_DAY);
        paperTradingSessionRepository.findOne.mockResolvedValue(
          makeSession({ totalTrades: 40, startedAt, createdAt: startedAt })
        );
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({ currentStage: PipelineStage.PAPER_TRADE, paperTradingSessionId: 'session-1' })
        );
        const status = await service.getStatusForUser('user-1');
        // session (0-1) + promotion (1-2)
        expect(status?.minDaysRemaining).toBe(1);
        expect(status?.maxDaysRemaining).toBe(3);
      });

      it('shows wide range bounded by 30-day cap before first trade completes', async () => {
        const startedAt = new Date(Date.now() - 2 * MS_PER_DAY);
        paperTradingSessionRepository.findOne.mockResolvedValue(
          makeSession({ totalTrades: 0, startedAt, createdAt: startedAt })
        );
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({ currentStage: PipelineStage.PAPER_TRADE, paperTradingSessionId: 'session-1' })
        );
        const status = await service.getStatusForUser('user-1');
        // session (1 to ~28) + promotion (1-2) → roughly (2, 30)
        expect(status?.minDaysRemaining).toBe(2);
        expect(status?.maxDaysRemaining).toBeGreaterThanOrEqual(29);
        expect(status?.maxDaysRemaining).toBeLessThanOrEqual(30);
      });

      it('derives tradesRequired from risk level when session.minTrades is null', async () => {
        paperTradingSessionRepository.findOne.mockResolvedValue(
          makeSession({ totalTrades: 5, minTrades: null as unknown as number })
        );
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({
            currentStage: PipelineStage.PAPER_TRADE,
            paperTradingSessionId: 'session-1',
            user: { id: 'user-1', coinRisk: { level: 1 } }
          } as unknown as Partial<Pipeline>)
        );
        const status = await service.getStatusForUser('user-1');
        // Risk level 1 → 50 min trades (see pipeline-orchestration.dto.ts)
        expect(status?.currentStageProgress).toEqual({ tradesCompleted: 5, tradesRequired: 50 });
      });

      it('uses DEFAULT_RISK_LEVEL (3 → 40 trades) when user.coinRisk is missing', async () => {
        paperTradingSessionRepository.findOne.mockResolvedValue(
          makeSession({ totalTrades: 5, minTrades: null as unknown as number })
        );
        pipelineRepository.findOne.mockResolvedValue(
          makePipeline({
            currentStage: PipelineStage.PAPER_TRADE,
            paperTradingSessionId: 'session-1',
            user: { id: 'user-1' }
          } as unknown as Partial<Pipeline>)
        );
        const status = await service.getStatusForUser('user-1');
        expect(status?.currentStageProgress).toEqual({ tradesCompleted: 5, tradesRequired: 40 });
      });
    });
  });
});
