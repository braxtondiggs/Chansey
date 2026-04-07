import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { OptimizationResult } from '../entities/optimization-result.entity';

/**
 * Query/CRUD service for optimization runs and results.
 * Handles reads and ranking — no orchestration logic.
 */
@Injectable()
export class OptimizationQueryService {
  constructor(
    @InjectRepository(OptimizationResult)
    private readonly optimizationResultRepository: Repository<OptimizationResult>,
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepository: Repository<StrategyConfig>
  ) {}

  /**
   * Rank all results by composite score using SQL (test score × consistency × overfit penalty).
   * Returns the rank-1 result, or null if no results exist.
   */
  async rankResults(runId: string): Promise<OptimizationResult | null> {
    // Update all ranks in a single SQL statement using a window function
    await this.optimizationResultRepository.query(
      `
      WITH ranked AS (
        SELECT id,
          ROW_NUMBER() OVER (
            ORDER BY
              "avgTestScore"
              * (0.6 + 0.4 * "consistencyScore" / 100)
              * GREATEST(0.5, 1.0 - 0.1 * "overfittingWindows")
            DESC
          ) AS new_rank
        FROM optimization_results
        WHERE "optimizationRunId" = $1
      )
      UPDATE optimization_results r
      SET rank = ranked.new_rank
      FROM ranked
      WHERE r.id = ranked.id
      `,
      [runId]
    );

    // Return only the rank-1 result
    return this.optimizationResultRepository.findOne({
      where: { optimizationRunId: runId, rank: 1 }
    });
  }

  /**
   * Find strategy config by ID (used by orchestrator during startOptimization)
   */
  async findStrategyConfig(strategyConfigId: string): Promise<StrategyConfig | null> {
    return this.strategyConfigRepository.findOne({
      where: { id: strategyConfigId }
    });
  }
}
