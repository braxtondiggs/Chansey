import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { toErrorInfo } from '../../shared/error.util';
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
   * Get strategy by algorithm ID (supports lazy initialization for runtime-activated algorithms)
   */
  async getStrategyForAlgorithm(algorithmId: string): Promise<AlgorithmStrategy | undefined> {
    const strategyId = this.algorithmToStrategy.get(algorithmId);
    if (strategyId) {
      return this.strategies.get(strategyId);
    }

    // Lazy init for runtime-activated algorithms
    return this.lazyInitAlgorithm(algorithmId);
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
    const strategy = await this.getStrategyForAlgorithm(algorithmId);

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
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Health check failed for strategy ${id}: ${err.message}`);
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
        const strategy = this.findStrategyByService(algorithm.service, algorithm.strategyId);

        if (strategy) {
          await strategy.onInit(algorithm);
          this.algorithmToStrategy.set(algorithm.id, strategy.id);
          this.logger.log(`Algorithm "${algorithm.name}" initialized with strategy "${strategy.name}"`);
        } else {
          this.logger.warn(`No strategy found for algorithm "${algorithm.name}" with service "${algorithm.service}"`);
        }
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to initialize algorithms: ${err.message}`);
    }
  }

  /**
   * Find strategy by strategyId (direct map lookup) or fallback to service name matching
   */
  private findStrategyByService(serviceName: string, strategyId?: string): AlgorithmStrategy | undefined {
    // Direct match by strategyId (most reliable, O(1))
    if (strategyId && this.strategies.has(strategyId)) {
      return this.strategies.get(strategyId);
    }

    // Fallback: legacy service name matching
    for (const strategy of this.strategies.values()) {
      if (strategy.constructor.name === serviceName || strategy.name === serviceName) {
        return strategy;
      }
    }
    return undefined;
  }

  /**
   * Lazy-initialize a runtime-activated algorithm that wasn't active at startup
   */
  private async lazyInitAlgorithm(algorithmId: string): Promise<AlgorithmStrategy | undefined> {
    try {
      const algorithm = await this.algorithmService.getAlgorithmById(algorithmId);
      if (!algorithm) return undefined;

      const strategy = this.findStrategyByService(algorithm.service, algorithm.strategyId);
      if (strategy) {
        await strategy.onInit(algorithm);
        this.algorithmToStrategy.set(algorithm.id, strategy.id);
        this.logger.log(`Lazy-initialized algorithm "${algorithm.name}" with strategy "${strategy.name}"`);
        return strategy;
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to lazy-init algorithm ${algorithmId}: ${err.message}`);
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
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Failed to destroy strategy ${strategy.id}: ${err.message}`);
      }
    });

    await Promise.allSettled(destroyPromises);
    this.strategies.clear();
    this.algorithmToStrategy.clear();
  }
}
