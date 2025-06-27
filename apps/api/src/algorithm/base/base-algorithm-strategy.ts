import { Injectable, Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

import { CronJob } from 'cron';

import { Algorithm, AlgorithmStatus } from '../algorithm.entity';
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

  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly description: string;

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
    return (
      context.coins && 
      context.coins.length > 0 && 
      context.priceData && 
      Object.keys(context.priceData).length > 0
    );
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
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get default configuration schema
   */
  getConfigSchema(): Record<string, unknown> {
    return {
      enabled: { type: 'boolean', default: true },
      weight: { type: 'number', default: 1.0, min: 0, max: 10 },
      riskLevel: { type: 'string', enum: ['low', 'medium', 'high'], default: 'medium' }
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
          signalsGenerated: result.signals.length
        },
        timestamp: new Date()
      };
    } catch (error) {
      this.logger.error(`Algorithm execution failed: ${error.message}`, error.stack);
      return this.createErrorResult(error.message, Date.now() - startTime);
    }
  }

  /**
   * Start cron job for scheduled execution
   */
  protected async startCronJob(): Promise<void> {
    if (!this.algorithm?.cron) return;

    try {
      this.cronJob = new CronJob(
        this.algorithm.cron,
        () => this.scheduledExecution(),
        null,
        false,
        'America/New_York'
      );

      this.schedulerRegistry.addCronJob(`${this.algorithm.name}_${this.id}`, this.cronJob);
      this.cronJob.start();
      
      this.logger.log(`Cron job started with schedule: ${this.algorithm.cron}`);
    } catch (error) {
      this.logger.error(`Failed to start cron job: ${error.message}`);
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
      } catch (error) {
        this.logger.error(`Failed to stop cron job: ${error.message}`);
      }
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
    metadata?: AlgorithmResult['metadata']
  ): AlgorithmResult {
    return {
      success: true,
      signals,
      chartData,
      metadata,
      metrics: {
        executionTime: 0, // Will be set by safeExecute
        signalsGenerated: signals.length,
        confidence: signals.length > 0 ? signals.reduce((sum, s) => sum + s.confidence, 0) / signals.length : 0
      },
      timestamp: new Date()
    };
  }
}
