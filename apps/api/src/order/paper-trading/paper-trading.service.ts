import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';

import { PipelineStartParams } from '@chansey/api-interfaces';

import { CreatePaperTradingSessionDto, UpdatePaperTradingSessionDto } from './dto';
import { PaperTradingAccount, PaperTradingSession, PaperTradingStatus } from './entities';
import { PaperTradingJobService } from './paper-trading-job.service';
import {
  NotifyPipelineJobData,
  PaperTradingJobType,
  StartSessionJobData,
  StopSessionJobData
} from './paper-trading.job-data';

import { Algorithm } from '../../algorithm/algorithm.entity';
import { DEFAULT_QUOTE_CURRENCY } from '../../exchange/constants';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { forceRemoveJob } from '../../shared/queue.util';
import { User } from '../../users/users.entity';
import { ExitConfig } from '../interfaces/exit-config.interface';

/**
 * Lifecycle / write operations for paper trading sessions.
 *
 * Read-only queries live in {@link PaperTradingQueryService}.
 */
@Injectable()
export class PaperTradingService {
  private readonly logger = new Logger(PaperTradingService.name);

  constructor(
    @InjectRepository(PaperTradingSession)
    private readonly sessionRepository: Repository<PaperTradingSession>,
    @InjectRepository(PaperTradingAccount)
    private readonly accountRepository: Repository<PaperTradingAccount>,
    @InjectRepository(Algorithm)
    private readonly algorithmRepository: Repository<Algorithm>,
    @InjectRepository(ExchangeKey)
    private readonly exchangeKeyRepository: Repository<ExchangeKey>,
    @InjectQueue('paper-trading')
    private readonly paperTradingQueue: Queue,
    private readonly dataSource: DataSource,
    private readonly jobService: PaperTradingJobService
  ) {}

  /**
   * Create a new paper trading session
   */
  async create(dto: CreatePaperTradingSessionDto, user: User): Promise<PaperTradingSession> {
    // Validate algorithm exists
    const algorithm = await this.algorithmRepository.findOne({ where: { id: dto.algorithmId } });
    if (!algorithm) {
      throw new NotFoundException(`Algorithm ${dto.algorithmId} not found`);
    }

    // Validate exchange key exists and belongs to user
    const exchangeKey = await this.exchangeKeyRepository.findOne({
      where: { id: dto.exchangeKeyId },
      relations: ['user', 'exchange']
    });
    if (!exchangeKey) {
      throw new NotFoundException(`Exchange key ${dto.exchangeKeyId} not found`);
    }
    if (exchangeKey.user.id !== user.id) {
      throw new ForbiddenException('Exchange key does not belong to user');
    }

    const session = this.sessionRepository.create({
      name: dto.name,
      description: dto.description,
      initialCapital: dto.initialCapital,
      tradingFee: dto.tradingFee ?? 0.001,
      tickIntervalMs: dto.tickIntervalMs ?? 30000,
      duration: dto.duration,
      stopConditions: dto.stopConditions,
      algorithmConfig: dto.algorithmConfig,
      exitConfig: dto.exitConfig as unknown as ExitConfig,
      status: PaperTradingStatus.PAUSED, // Start paused until explicitly started
      user,
      algorithm,
      exchangeKey
    });

    const savedSession = await this.sessionRepository.save(session);

    // Initialize quote currency account with initial capital
    const quoteCurrency = dto.quoteCurrency ?? DEFAULT_QUOTE_CURRENCY;
    const quoteAccount = this.accountRepository.create({
      currency: quoteCurrency,
      available: dto.initialCapital,
      locked: 0,
      session: savedSession
    });
    await this.accountRepository.save(quoteAccount);

    this.logger.log(`Created paper trading session ${savedSession.id} for user ${user.id}`);

    return this.findOne(savedSession.id, user);
  }

  /**
   * Find a session by ID + user ownership.
   *
   * Kept private here so the lifecycle methods can validate ownership without
   * a cross-service dependency on `PaperTradingQueryService`. The public copy
   * lives on `PaperTradingQueryService.findOne` for the controller to consume.
   */
  private async findOne(id: string, user: User): Promise<PaperTradingSession> {
    const session = await this.sessionRepository.findOne({
      where: { id, user: { id: user.id } },
      relations: ['algorithm', 'exchangeKey', 'exchangeKey.exchange', 'accounts']
    });

    if (!session) {
      throw new NotFoundException(`Paper trading session ${id} not found`);
    }

    return session;
  }

  /**
   * Update a session
   */
  async update(id: string, dto: UpdatePaperTradingSessionDto, user: User): Promise<PaperTradingSession> {
    const session = await this.findOne(id, user);

    if (session.status === PaperTradingStatus.ACTIVE) {
      throw new BadRequestException('Cannot update an active session. Pause it first.');
    }

    Object.assign(session, dto);
    await this.sessionRepository.save(session);

    return this.findOne(id, user);
  }

  /**
   * Delete a session
   */
  async delete(id: string, user: User): Promise<void> {
    const session = await this.findOne(id, user);

    if (session.status === PaperTradingStatus.ACTIVE) {
      throw new BadRequestException('Cannot delete an active session. Stop it first.');
    }

    // Remove tick jobs if any exist
    await this.jobService.removeTickJobs(id);

    await this.sessionRepository.remove(session);
    this.logger.log(`Deleted paper trading session ${id}`);
  }

  /**
   * Start a paper trading session with atomic transaction
   */
  async start(id: string, user: User): Promise<PaperTradingSession> {
    const session = await this.findOne(id, user);

    if (session.status === PaperTradingStatus.ACTIVE) {
      throw new BadRequestException('Session is already active');
    }
    if (session.status === PaperTradingStatus.COMPLETED || session.status === PaperTradingStatus.FAILED) {
      throw new BadRequestException('Cannot start a completed or failed session');
    }

    // Use transaction to ensure session state and job scheduling are atomic
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      session.status = PaperTradingStatus.ACTIVE;
      session.startedAt = session.startedAt ?? new Date();
      session.pausedAt = undefined;
      session.consecutiveErrors = 0;
      session.retryAttempts = 0;
      await transactionalEntityManager.save(session);

      // Queue the start job within the transaction
      // If this fails, the transaction will rollback the session state change
      const jobData: StartSessionJobData = {
        type: PaperTradingJobType.START_SESSION,
        sessionId: id,
        userId: user.id
      };

      // Remove any stale job with the same ID to prevent BullMQ jobId collision after deployment
      await forceRemoveJob(this.paperTradingQueue, `paper-trading-start-${id}`, this.logger);
      await this.paperTradingQueue.add('start-session', jobData, {
        jobId: `paper-trading-start-${id}`
      });
    });

    this.logger.log(`Started paper trading session ${id}`);

    return this.findOne(id, user);
  }

  /**
   * Pause a paper trading session with atomic transaction
   */
  async pause(id: string, user: User): Promise<PaperTradingSession> {
    const session = await this.findOne(id, user);

    if (session.status !== PaperTradingStatus.ACTIVE) {
      throw new BadRequestException('Can only pause an active session');
    }

    // Use transaction to ensure session state and job removal are atomic
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      session.status = PaperTradingStatus.PAUSED;
      session.pausedAt = new Date();
      await transactionalEntityManager.save(session);

      // Remove tick jobs within transaction context
      // If job removal fails, the session state change will be rolled back
      await this.jobService.removeTickJobs(id);
    });

    this.logger.log(`Paused paper trading session ${id}`);

    return this.findOne(id, user);
  }

  /**
   * Resume a paused paper trading session with atomic transaction
   */
  async resume(id: string, user: User): Promise<PaperTradingSession> {
    const session = await this.findOne(id, user);

    if (session.status !== PaperTradingStatus.PAUSED) {
      throw new BadRequestException('Can only resume a paused session');
    }

    // Use transaction to ensure session state and job scheduling are atomic
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      session.status = PaperTradingStatus.ACTIVE;
      session.pausedAt = undefined;
      session.consecutiveErrors = 0;
      session.retryAttempts = 0;
      await transactionalEntityManager.save(session);

      // Schedule tick job within transaction context
      // If scheduling fails, the session state change will be rolled back
      await this.jobService.scheduleTickJob(id, user.id, session.tickIntervalMs);
    });

    this.logger.log(`Resumed paper trading session ${id}`);

    return this.findOne(id, user);
  }

  /**
   * Stop a paper trading session with atomic transaction
   */
  async stop(id: string, user: User, reason = 'user_cancelled'): Promise<PaperTradingSession> {
    const session = await this.findOne(id, user);

    if (session.status === PaperTradingStatus.STOPPED || session.status === PaperTradingStatus.COMPLETED) {
      throw new BadRequestException('Session is already stopped or completed');
    }

    // Use transaction to ensure session state, job removal, and stop job are atomic
    await this.dataSource.transaction(async (transactionalEntityManager) => {
      session.status = PaperTradingStatus.STOPPED;
      session.stoppedAt = new Date();
      session.stoppedReason = reason;
      await transactionalEntityManager.save(session);

      // Remove tick jobs within transaction context
      await this.jobService.removeTickJobs(id);

      // Queue stop job for final metric calculation
      const jobData: StopSessionJobData = {
        type: PaperTradingJobType.STOP_SESSION,
        sessionId: id,
        userId: user.id,
        reason
      };

      // Remove any stale jobs to prevent BullMQ jobId collision after deployment
      await forceRemoveJob(this.paperTradingQueue, `paper-trading-stop-${id}`, this.logger);
      await this.paperTradingQueue.add('stop-session', jobData, {
        jobId: `paper-trading-stop-${id}`
      });

      // Queue pipeline notification within transaction for reliable delivery
      // This ensures the notification is persisted even if the process crashes
      if (session.pipelineId) {
        const notifyJobData: NotifyPipelineJobData = {
          type: PaperTradingJobType.NOTIFY_PIPELINE,
          sessionId: id,
          userId: user.id,
          pipelineId: session.pipelineId,
          stoppedReason: reason
        };

        await forceRemoveJob(this.paperTradingQueue, `paper-trading-notify-${id}`, this.logger);
        await this.paperTradingQueue.add('notify-pipeline', notifyJobData, {
          jobId: `paper-trading-notify-${id}`
        });
      }
    });

    this.logger.log(`Stopped paper trading session ${id} (reason: ${reason})`);

    return this.findOne(id, user);
  }

  /**
   * Start a paper trading session from pipeline orchestrator
   * Called by PipelineOrchestratorService
   */
  async startFromPipeline(params: PipelineStartParams): Promise<PaperTradingSession> {
    const user = { id: params.userId } as User;

    // Defense-in-depth: block if an active session already exists for this
    // (user, algorithm). Excludes the current pipeline's own session in case
    // of retry. The orchestration-level checkDuplicate is the primary guard;
    // this prevents silent duplicates if orchestration is bypassed.
    const existing = await this.sessionRepository
      .createQueryBuilder('s')
      .where('s.userId = :userId', { userId: params.userId })
      .andWhere('s.algorithmId = :algorithmId', { algorithmId: params.algorithmId })
      .andWhere('s.status IN (:...active)', {
        active: [PaperTradingStatus.ACTIVE, PaperTradingStatus.PAUSED]
      })
      .andWhere('(s.pipelineId IS NULL OR s.pipelineId != :pipelineId)', {
        pipelineId: params.pipelineId
      })
      .getOne();

    if (existing) {
      throw new BadRequestException(
        `Cannot start paper-trading from pipeline ${params.pipelineId}: ` +
          `an active session (${existing.id}, status=${existing.status}) already exists ` +
          `for user ${params.userId} and algorithm ${params.algorithmId}.`
      );
    }

    // Create session with pipeline context
    const dto: CreatePaperTradingSessionDto = {
      name: params.name ?? `Pipeline ${params.pipelineId} - Paper Trading`,
      algorithmId: params.algorithmId,
      exchangeKeyId: params.exchangeKeyId,
      initialCapital: params.initialCapital,
      duration: params.duration,
      stopConditions: params.stopConditions,
      algorithmConfig: params.optimizedParameters
    };

    const session = await this.create(dto, user);

    // Set pipeline ID, risk level, exit config, and min trades
    session.pipelineId = params.pipelineId;
    if (params.riskLevel != null) {
      session.riskLevel = params.riskLevel;
    }
    if (params.exitConfig) {
      session.exitConfig = params.exitConfig as unknown as ExitConfig;
    }
    if (params.minTrades != null) {
      session.minTrades = params.minTrades;
    }
    await this.sessionRepository.save(session);

    // Auto-start the session
    return this.start(session.id, user);
  }
}
