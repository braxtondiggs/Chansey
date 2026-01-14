import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { AlgorithmService } from '../algorithm.service';
import { AlgorithmContext, AlgorithmResult, AlgorithmStrategy } from '../interfaces';

/**
 * Registry that manages all algorithm strategies
 * Handles discovery, initialization, and lifecycle management
 */
@Injectable()
export class AlgorithmRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlgorithmRegistry.name);
  private readonly strategies = new Map<string, AlgorithmStrategy>();
  private readonly algorithmToStrategy = new Map<string, string>();

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly algorithmService: AlgorithmService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.discoverStrategies();
    await this.initializeActiveAlgorithms();
  }

  async onModuleDestroy(): Promise<void> {
    await this.destroyAllStrategies();
  }

  /**
   * Register a strategy manually
   */
  registerStrategy(strategy: AlgorithmStrategy): void {
    this.strategies.set(strategy.id, strategy);
    this.logger.log(`Strategy registered: ${strategy.name} (${strategy.id})`);
  }

  /**
   * Get a strategy by ID
   */
  getStrategy(strategyId: string): AlgorithmStrategy | undefined {
    return this.strategies.get(strategyId);
  }

  /**
   * Get strategy by algorithm ID
   */
  getStrategyForAlgorithm(algorithmId: string): AlgorithmStrategy | undefined {
    const strategyId = this.algorithmToStrategy.get(algorithmId);
    return strategyId ? this.strategies.get(strategyId) : undefined;
  }

  /**
   * Get all registered strategies
   */
  getAllStrategies(): AlgorithmStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Execute an algorithm by ID
   */
  async executeAlgorithm(algorithmId: string, context: AlgorithmContext): Promise<AlgorithmResult> {
    const strategy = this.getStrategyForAlgorithm(algorithmId);

    if (!strategy) {
      throw new AlgorithmNotRegisteredException(algorithmId);
    }

    if ('safeExecute' in strategy && typeof strategy.safeExecute === 'function') {
      return await (
        strategy as unknown as { safeExecute(context: AlgorithmContext): Promise<AlgorithmResult> }
      ).safeExecute(context);
    }

    return await strategy.execute(context);
  }

  /**
   * Get health status of all strategies
   */
  async getHealthStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};

    for (const [id, strategy] of this.strategies.entries()) {
      try {
        status[id] = strategy.healthCheck ? await strategy.healthCheck() : true;
      } catch (error) {
        this.logger.error(`Health check failed for strategy ${id}: ${error.message}`);
        status[id] = false;
      }
    }

    return status;
  }

  /**
   * Discover strategies from the module
   */
  private async discoverStrategies(): Promise<void> {
    // This method should be implemented to discover strategies
    // For now, strategies need to be manually registered
    this.logger.log('Strategy discovery completed');
  }

  /**
   * Initialize active algorithms with their strategies
   */
  private async initializeActiveAlgorithms(): Promise<void> {
    try {
      const algorithms = await this.algorithmService.getActiveAlgorithms();

      for (const algorithm of algorithms) {
        const strategy = this.findStrategyByService(algorithm.service);

        if (strategy) {
          await strategy.onInit(algorithm);
          this.algorithmToStrategy.set(algorithm.id, strategy.id);
          this.logger.log(`Algorithm "${algorithm.name}" initialized with strategy "${strategy.name}"`);
        } else {
          this.logger.warn(`No strategy found for algorithm "${algorithm.name}" with service "${algorithm.service}"`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to initialize algorithms: ${error.message}`);
    }
  }

  /**
   * Find strategy by service name
   */
  private findStrategyByService(serviceName: string): AlgorithmStrategy | undefined {
    for (const strategy of this.strategies.values()) {
      if (strategy.constructor.name === serviceName || strategy.name === serviceName) {
        return strategy;
      }
    }
    return undefined;
  }

  /**
   * Destroy all strategies
   */
  private async destroyAllStrategies(): Promise<void> {
    const destroyPromises = Array.from(this.strategies.values()).map(async (strategy) => {
      try {
        if (strategy.onDestroy) {
          await strategy.onDestroy();
        }
      } catch (error) {
        this.logger.error(`Failed to destroy strategy ${strategy.id}: ${error.message}`);
      }
    });

    await Promise.allSettled(destroyPromises);
    this.strategies.clear();
    this.algorithmToStrategy.clear();
  }
}
