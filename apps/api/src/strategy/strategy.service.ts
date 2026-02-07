import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import {
  AuditEventType,
  CreateStrategyConfigDto,
  StrategyConfigListFilters,
  StrategyStatus,
  UpdateStrategyConfigDto
} from '@chansey/api-interfaces';

import { BacktestRun } from './entities/backtest-run.entity';
import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';

import { AlgorithmService } from '../algorithm/algorithm.service';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { AuditService } from '../audit/audit.service';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Strategy Service
 * Manages strategy configurations (variations of existing algorithms)
 * Integrates with AlgorithmRegistry to execute strategies
 */
@Injectable()
export class StrategyService {
  private readonly logger = new Logger(StrategyService.name);

  constructor(
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(BacktestRun)
    private readonly backtestRunRepo: Repository<BacktestRun>,
    @InjectRepository(StrategyScore)
    private readonly strategyScoreRepo: Repository<StrategyScore>,
    private readonly algorithmService: AlgorithmService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly auditService: AuditService,
    private readonly metricsService: MetricsService
  ) {}

  /**
   * Create a new strategy configuration
   */
  async create(dto: CreateStrategyConfigDto, userId?: string): Promise<StrategyConfig> {
    // Verify algorithm exists
    const algorithm = await this.algorithmService.getAlgorithmById(dto.algorithmId);
    if (!algorithm) {
      throw new NotFoundException(`Algorithm with ID ${dto.algorithmId} not found`);
    }

    // Verify algorithm is registered in AlgorithmRegistry
    const registeredStrategy = await this.algorithmRegistry.getStrategyForAlgorithm(algorithm.id);
    if (!registeredStrategy) {
      throw new BadRequestException(`Algorithm ${algorithm.id} not registered in AlgorithmRegistry`);
    }

    const strategyConfig = this.strategyConfigRepo.create({
      name: dto.name,
      algorithmId: dto.algorithmId,
      parameters: dto.parameters,
      version: dto.version || '1.0.0',
      parentId: dto.parentId,
      createdBy: userId,
      status: StrategyStatus.DRAFT
    });

    const saved = await this.strategyConfigRepo.save(strategyConfig);

    // Create audit log
    await this.auditService.createAuditLog({
      eventType: AuditEventType.STRATEGY_CREATED,
      entityType: 'strategy',
      entityId: saved.id,
      userId,
      afterState: {
        name: saved.name,
        algorithmId: saved.algorithmId,
        parameters: saved.parameters,
        version: saved.version,
        status: saved.status
      },
      metadata: {
        algorithmName: algorithm.name
      }
    });

    this.logger.log(`Strategy config created: ${saved.name} (${saved.id})`);

    return saved;
  }

  /**
   * Find strategy config by ID
   */
  async findOne(id: string): Promise<StrategyConfig> {
    const strategy = await this.strategyConfigRepo.findOne({
      where: { id },
      relations: ['algorithm', 'creator']
    });

    if (!strategy) {
      throw new NotFoundException(`Strategy config with ID ${id} not found`);
    }

    return strategy;
  }

  /**
   * Find all strategy configs with filters
   */
  async findAll(filters: StrategyConfigListFilters): Promise<{ strategies: StrategyConfig[]; total: number }> {
    const qb = this.strategyConfigRepo
      .createQueryBuilder('strategy')
      .leftJoinAndSelect('strategy.algorithm', 'algorithm');

    // Apply filters
    if (filters.status) {
      if (Array.isArray(filters.status)) {
        qb.andWhere('strategy.status IN (:...statuses)', { statuses: filters.status });
      } else {
        qb.andWhere('strategy.status = :status', { status: filters.status });
      }
    }

    if (filters.algorithmId) {
      qb.andWhere('strategy.algorithmId = :algorithmId', { algorithmId: filters.algorithmId });
    }

    if (filters.search) {
      qb.andWhere('strategy.name ILIKE :search', { search: `%${filters.search}%` });
    }

    // Sorting
    const sortBy = filters.sortBy || 'createdAt';
    const sortOrder = filters.sortOrder || 'DESC';
    qb.orderBy(`strategy.${sortBy}`, sortOrder);

    // Get total count
    const total = await qb.getCount();

    // Pagination
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    qb.skip(offset).take(limit);

    const strategies = await qb.getMany();

    return { strategies, total };
  }

  /**
   * Update strategy config
   */
  async update(id: string, dto: UpdateStrategyConfigDto, userId?: string): Promise<StrategyConfig> {
    const strategy = await this.findOne(id);

    const beforeState = {
      name: strategy.name,
      parameters: strategy.parameters,
      version: strategy.version,
      status: strategy.status
    };

    // Apply updates
    if (dto.name) strategy.name = dto.name;
    if (dto.parameters) strategy.parameters = dto.parameters;
    if (dto.version) strategy.version = dto.version;
    if (dto.status) strategy.status = dto.status;

    const updated = await this.strategyConfigRepo.save(strategy);

    // Create audit log
    await this.auditService.createAuditLog({
      eventType: AuditEventType.STRATEGY_UPDATED,
      entityType: 'strategy',
      entityId: updated.id,
      userId,
      beforeState,
      afterState: {
        name: updated.name,
        parameters: updated.parameters,
        version: updated.version,
        status: updated.status
      },
      metadata: {
        changes: Object.keys(dto)
      }
    });

    this.logger.log(`Strategy config updated: ${updated.name} (${updated.id})`);

    return updated;
  }

  /**
   * Delete strategy config
   */
  async delete(id: string, userId?: string): Promise<void> {
    const strategy = await this.findOne(id);

    // Create audit log before deletion
    await this.auditService.createAuditLog({
      eventType: AuditEventType.STRATEGY_DELETED,
      entityType: 'strategy',
      entityId: strategy.id,
      userId,
      beforeState: {
        name: strategy.name,
        algorithmId: strategy.algorithmId,
        parameters: strategy.parameters,
        status: strategy.status
      }
    });

    await this.strategyConfigRepo.remove(strategy);

    this.logger.log(`Strategy config deleted: ${strategy.name} (${id})`);
  }

  /**
   * Get strategy instance from AlgorithmRegistry with merged parameters
   */
  async getStrategyInstance(strategyConfigId: string): Promise<any> {
    const strategyConfig = await this.findOne(strategyConfigId);
    const algorithm = await this.algorithmService.getAlgorithmById(strategyConfig.algorithmId);

    // Get strategy implementation from registry
    const strategy = await this.algorithmRegistry.getStrategyForAlgorithm(algorithm.id);

    // Merge parameters (StrategyConfig overrides Algorithm defaults)
    const mergedConfig = {
      ...algorithm.config?.parameters,
      ...strategyConfig.parameters
    };

    // Return strategy with merged config
    return {
      strategy,
      config: mergedConfig,
      algorithmName: algorithm.name,
      strategyName: strategyConfig.name
    };
  }

  /**
   * Get latest backtest run for strategy
   */
  async getLatestBacktestRun(strategyConfigId: string): Promise<BacktestRun | null> {
    return this.backtestRunRepo.findOne({
      where: { strategyConfigId },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Get latest score for strategy
   */
  async getLatestScore(strategyConfigId: string): Promise<StrategyScore | null> {
    return this.strategyScoreRepo.findOne({
      where: { strategyConfigId },
      order: { calculatedAt: 'DESC' }
    });
  }

  /**
   * Get all strategies by status
   */
  async findByStatus(status: StrategyStatus): Promise<StrategyConfig[]> {
    return this.strategyConfigRepo.find({
      where: { status },
      relations: ['algorithm']
    });
  }

  /**
   * Update strategy status
   */
  async updateStatus(id: string, status: StrategyStatus, userId?: string): Promise<StrategyConfig> {
    return this.update(id, { status }, userId);
  }

  // ===================
  // Heartbeat Methods
  // ===================

  /**
   * Record a successful heartbeat for a strategy
   * Call this when a strategy successfully executes a cycle
   */
  async recordHeartbeat(strategyId: string): Promise<void> {
    const strategy = await this.strategyConfigRepo.findOne({ where: { id: strategyId } });
    if (!strategy) {
      this.logger.warn(`Cannot record heartbeat: Strategy ${strategyId} not found`);
      return;
    }

    strategy.lastHeartbeat = new Date();
    strategy.heartbeatFailures = 0;
    strategy.lastError = null;
    strategy.lastErrorAt = null;

    await this.strategyConfigRepo.save(strategy);

    // Record metric
    this.metricsService.recordStrategyHeartbeat(strategy.name, 'success');
    this.metricsService.setStrategyHeartbeatFailures(strategy.name, 0);

    this.logger.debug(`Heartbeat recorded for strategy: ${strategy.name}`);
  }

  /**
   * Record a failed heartbeat for a strategy
   * Call this when a strategy fails to execute properly
   */
  async recordHeartbeatFailure(strategyId: string, error: string): Promise<void> {
    const strategy = await this.strategyConfigRepo.findOne({ where: { id: strategyId } });
    if (!strategy) {
      this.logger.warn(`Cannot record heartbeat failure: Strategy ${strategyId} not found`);
      return;
    }

    strategy.heartbeatFailures = (strategy.heartbeatFailures || 0) + 1;
    strategy.lastError = error.substring(0, 500); // Truncate to 500 chars
    strategy.lastErrorAt = new Date();

    await this.strategyConfigRepo.save(strategy);

    // Record metric
    this.metricsService.recordStrategyHeartbeat(strategy.name, 'failed');
    this.metricsService.setStrategyHeartbeatFailures(strategy.name, strategy.heartbeatFailures);

    this.logger.warn(
      `Heartbeat failure recorded for strategy: ${strategy.name} (${strategy.heartbeatFailures} consecutive failures)`
    );
  }

  /**
   * Update all strategy heartbeat metrics for Prometheus
   * Should be called periodically (e.g., every minute)
   *
   * Note on heartbeat age handling:
   * - Strategies with no heartbeat (lastHeartbeat is null) get Infinity age internally
   * - The heartbeat age metric is NOT emitted for strategies that have never sent a heartbeat
   * - For health score calculation, Infinity is converted to 99999 seconds (~27.7 hours)
   *   to ensure metric systems receive a finite value while still indicating unhealthy state
   */
  async updateHeartbeatMetrics(): Promise<void> {
    const activeStatuses = [StrategyStatus.LIVE, StrategyStatus.TESTING];
    const strategies = await this.strategyConfigRepo.find({
      where: { status: In(activeStatuses) }
    });

    const now = Date.now();

    for (const strategy of strategies) {
      // Calculate heartbeat age in seconds
      // Strategies that have never sent a heartbeat get Infinity (handled specially below)
      const heartbeatAge = strategy.lastHeartbeat
        ? Math.floor((now - strategy.lastHeartbeat.getTime()) / 1000)
        : Infinity;

      // Only emit heartbeat age metric if strategy has sent at least one heartbeat
      // This avoids polluting metrics with strategies still in initial setup
      if (heartbeatAge !== Infinity) {
        this.metricsService.setStrategyHeartbeatAge(strategy.name, strategy.shadowStatus, heartbeatAge);
      }

      this.metricsService.setStrategyHeartbeatFailures(strategy.name, strategy.heartbeatFailures || 0);

      // Calculate and set health score
      // Use 99999 as sentinel value for "never received heartbeat" - large enough to
      // indicate critical health but finite for Prometheus/Grafana compatibility
      this.metricsService.calculateAndSetHealthScore(
        strategy.name,
        strategy.shadowStatus,
        heartbeatAge === Infinity ? 99999 : heartbeatAge,
        strategy.heartbeatFailures || 0,
        300 // Expected heartbeat every 5 minutes
      );
    }

    this.logger.debug(`Updated heartbeat metrics for ${strategies.length} strategies`);
  }

  /**
   * Get strategies with stale heartbeats (no heartbeat for more than threshold)
   * @param thresholdMinutes Number of minutes after which a heartbeat is considered stale
   */
  async getStrategiesWithStaleHeartbeats(thresholdMinutes = 10): Promise<StrategyConfig[]> {
    const threshold = new Date(Date.now() - thresholdMinutes * 60 * 1000);
    const activeStatuses = [StrategyStatus.LIVE, StrategyStatus.TESTING];

    return this.strategyConfigRepo
      .createQueryBuilder('strategy')
      .where('strategy.status IN (:...statuses)', { statuses: activeStatuses })
      .andWhere('(strategy.lastHeartbeat < :threshold OR strategy.lastHeartbeat IS NULL)', { threshold })
      .getMany();
  }

  /**
   * Get strategies with multiple consecutive heartbeat failures
   * @param minFailures Minimum number of consecutive failures
   */
  async getStrategiesWithHeartbeatFailures(minFailures = 3): Promise<StrategyConfig[]> {
    return this.strategyConfigRepo
      .find({
        where: {
          status: In([StrategyStatus.LIVE, StrategyStatus.TESTING])
        }
      })
      .then((strategies) => strategies.filter((s) => (s.heartbeatFailures || 0) >= minFailures));
  }
}
