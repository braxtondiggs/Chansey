import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  CreateStrategyConfigDto,
  UpdateStrategyConfigDto,
  StrategyConfigListFilters,
  StrategyStatus,
  AuditEventType
} from '@chansey/api-interfaces';

import { BacktestRun } from './entities/backtest-run.entity';
import { StrategyConfig } from './entities/strategy-config.entity';
import { StrategyScore } from './entities/strategy-score.entity';

import { AlgorithmService } from '../algorithm/algorithm.service';
import { AlgorithmRegistry } from '../algorithm/registry/algorithm-registry.service';
import { AuditService } from '../audit/audit.service';

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
    private readonly auditService: AuditService
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
    try {
      this.algorithmRegistry.getStrategyForAlgorithm(algorithm.id);
    } catch (error) {
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
    const strategy = this.algorithmRegistry.getStrategyForAlgorithm(algorithm.id);

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
}
