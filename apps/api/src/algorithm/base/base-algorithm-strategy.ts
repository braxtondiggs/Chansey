import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CronJob } from 'cron';

import { ParameterConstraint } from '../../optimization/interfaces/parameter-space.interface';
import { ExitConfig } from '../../order/interfaces/exit-config.interface';
import { toErrorInfo } from '../../shared/error.util';
import { Algorithm, AlgorithmStatus } from '../algorithm.entity';
import { IndicatorRequirement } from '../indicators/indicator-requirements.interface';
import { AlgorithmContext, AlgorithmResult, AlgorithmStrategy } from '../interfaces';

/**
 * Abstract base class for all algorithm implementations
 * Provides common functionality and structure
 */
@Injectable()
export abstract class BaseAlgorithmStrategy implements AlgorithmStrategy {
  protected readonly logger: Logger;
  protected algorithm: Algorithm;
  protected cronJob?: CronJob;

  /** Strategy ID - must match strategyId in the Algorithm database record */
  abstract readonly id: string;

  get name(): string {
    return this.algorithm?.name ?? this.constructor.name;
  }

  get version(): string {
    return this.algorithm?.version ?? '1.0.0';
  }

  get description(): string {
    return this.algorithm?.description ?? '';
  }

  constructor(protected readonly schedulerRegistry: SchedulerRegistry) {
    this.logger = new Logger(this.constructor.name);
  }

  /**
   * Initialize the algorithm
   */
  async onInit(algorithm: Algorithm): Promise<void> {
    this.algorithm = algorithm;
    this.logger.log(`Algorithm "${algorithm.name}" initialized successfully`);

    if (this.shouldStartCronJob()) {
      await this.startCronJob();
    }
  }

  /**
   * Abstract method that must be implemented by each algorithm
   */
  abstract execute(context: AlgorithmContext): Promise<AlgorithmResult>;

  /**
   * Default implementation of canExecute
   */
  canExecute(context: AlgorithmContext): boolean {
    return context.coins && context.coins.length > 0 && context.priceData && Object.keys(context.priceData).length > 0;
  }

  /**
   * Cleanup when algorithm is destroyed
   */
  async onDestroy(): Promise<void> {
    if (this.cronJob) {
      this.stopCronJob();
    }
    this.logger.log(`Algorithm "${this.algorithm?.name}" destroyed`);
  }

  /**
   * Health check implementation
   */
  async healthCheck(): Promise<boolean> {
    try {
      return this.algorithm?.status === AlgorithmStatus.ACTIVE;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Health check failed: ${err.message}`);
      return false;
    }
  }

  /**
   * Get cross-parameter constraints for optimization.
   * Override in strategies with related parameters (e.g., fastPeriod < slowPeriod).
   */
  getParameterConstraints(): ParameterConstraint[] {
    return [];
  }

  /**
   * Declare indicator requirements for precomputation during optimization.
   * Override in strategies to enable the fast path (bypass per-timestamp Redis).
   */
  getIndicatorRequirements(_config: Record<string, unknown>): IndicatorRequirement[] {
    return [];
  }

  /**
   * Return the minimum number of price data points required for signal generation.
   * Override in concrete strategies; default 0 means "no minimum".
   */
  getMinDataPoints(_config: Record<string, unknown>): number {
    return 0;
  }

  /**
   * Get default configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      enabled: { type: 'boolean', default: true },
      riskLevel: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' },
      cooldownMs: {
        type: 'number',
        default: 86400000,
        min: 0,
        max: 604800000,
        description: 'Signal cooldown per coin+direction (ms)'
      },
      maxTradesPerDay: {
        type: 'number',
        default: 6,
        min: 0,
        max: 50,
        description: 'Max trades per 24h window'
      },
      minSellPercent: {
        type: 'number',
        default: 0.5,
        min: 0,
        max: 1.0,
        description: 'Minimum sell percentage per signal'
      }
    };
  }

  /**
   * Execute the algorithm with error handling and metrics
   */
  async safeExecute(context: AlgorithmContext): Promise<AlgorithmResult> {
    const startTime = Date.now();

    try {
      if (!this.canExecute(context)) {
        return this.createErrorResult('Algorithm cannot execute with provided context');
      }

      const result = await this.execute(context);
      const executionTime = Date.now() - startTime;

      return {
        ...result,
        metrics: {
          ...result.metrics,
          executionTime,
          signalsGenerated: result.signals.length,
          confidence: result.metrics?.confidence ?? 0
        },
        timestamp: new Date()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Algorithm execution failed: ${err.message}`, err.stack);
      return this.createErrorResult(err.message, Date.now() - startTime);
    }
  }

  /**
   * Start cron job for scheduled execution
   */
  protected async startCronJob(): Promise<void> {
    if (!this.algorithm?.cron) return;

    try {
      const jobName = `${this.algorithm.name}_${this.id}`;

      // Idempotent: remove existing job before re-registering
      try {
        this.schedulerRegistry.deleteCronJob(jobName);
      } catch {
        // Job doesn't exist yet — expected on first registration
      }

      this.cronJob = new CronJob(this.algorithm.cron, () => this.scheduledExecution(), null, false, 'America/New_York');
      this.schedulerRegistry.addCronJob(jobName, this.cronJob);
      this.cronJob.start();

      this.logger.log(`Cron job started with schedule: ${this.algorithm.cron}`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to start cron job: ${err.message}`);
    }
  }

  /**
   * Stop cron job
   */
  protected stopCronJob(): void {
    if (this.cronJob) {
      const jobName = `${this.algorithm.name}_${this.id}`;
      try {
        this.schedulerRegistry.deleteCronJob(jobName);
        this.cronJob = undefined;
        this.logger.log('Cron job stopped');
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to stop cron job: ${err.message}`);
      }
    }
  }

  /**
   * Restart the cron job for auto-recovery.
   * Safe to call even if the job is already running (idempotent via startCronJob).
   */
  async restartCronJob(): Promise<void> {
    if (this.shouldStartCronJob()) {
      this.logger.log(`Restarting cron job for algorithm "${this.algorithm?.name}"`);
      await this.startCronJob();
    }
  }

  /**
   * Override this method to customize when cron job should start
   */
  protected shouldStartCronJob(): boolean {
    return process.env.NODE_ENV === 'production' && this.algorithm?.status === AlgorithmStatus.ACTIVE;
  }

  /**
   * Override this method to implement scheduled execution logic
   */
  protected async scheduledExecution(): Promise<void> {
    this.logger.log('Scheduled execution started');
    // Subclasses should implement their own scheduled execution logic
  }

  /**
   * Retrieve a precomputed indicator slice matching the current price window.
   * Returns undefined when precomputed data is not available (legacy path).
   */
  protected getPrecomputedSlice(
    context: AlgorithmContext,
    coinId: string,
    key: string,
    windowLength: number
  ): number[] | undefined {
    const fullSeries = context.precomputedIndicators?.[coinId]?.[key];
    if (!fullSeries || context.currentTimestampIndex == null) return undefined;
    const idx = context.currentTimestampIndex;
    const start = Math.max(0, idx - windowLength + 1);
    if (fullSeries instanceof Float64Array) {
      return Array.from(fullSeries.subarray(start, idx + 1));
    }
    return (fullSeries as number[]).slice(start, idx + 1);
  }

  /**
   * Helper method to create error results
   */
  protected createErrorResult(error: string, executionTime = 0): AlgorithmResult {
    return {
      success: false,
      signals: [],
      error,
      metrics: {
        executionTime,
        signalsGenerated: 0,
        confidence: 0
      },
      timestamp: new Date()
    };
  }

  /**
   * Helper method to create success results
   */
  protected createSuccessResult(
    signals: AlgorithmResult['signals'],
    chartData?: AlgorithmResult['chartData'],
    metadata?: AlgorithmResult['metadata'],
    exitConfig?: Partial<ExitConfig>
  ): AlgorithmResult {
    return {
      success: true,
      signals,
      chartData,
      metadata,
      exitConfig,
      metrics: {
        executionTime: 0, // Will be set by safeExecute
        signalsGenerated: signals.length,
        confidence: signals.length > 0 ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length : 0
      },
      timestamp: new Date()
    };
  }
}
