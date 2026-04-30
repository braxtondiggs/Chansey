import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { OptimizationResult } from '../entities/optimization-result.entity';
import { MIN_TOTAL_TRADES } from '../utils/optimization-scoring.util';

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
   * Rank all results by composite score using SQL.
   * Composite ranking score: avgTestScore × consistency × overfit penalty × trade multiplier
   * (LEAST(1.0, totalTrades / MIN_TOTAL_TRADES)). Rows with `total_trades = 0` (empty array,
   * all-zero array, or NULL `windowResults`) are parked **last** via a CASE expression that
   * emits NULL combined with `NULLS LAST` — otherwise a zero-trade row could sort above any
   * combo with a negative score, since multiplying by 0 made `0 > negative_score` under DESC.
   *
   * Returns the rank-1 result, or null if no results exist.
   */
  async rankResults(runId: string): Promise<OptimizationResult | null> {
    // Update all ranks in a single SQL statement using a window function.
    // MIN_TOTAL_TRADES is a compile-time constant template-literal injected (no $N param
    // because constants in expressions can't bind via positional parameters).
    await this.optimizationResultRepository.query(
      `
      WITH totals AS (
        SELECT
          id,
          "avgTestScore",
          "consistencyScore",
          "overfittingWindows",
          COALESCE((
            SELECT SUM((wr->>'tradeCount')::int)
            FROM jsonb_array_elements("windowResults") wr
          ), 0) AS total_trades
        FROM optimization_results
        WHERE "optimizationRunId" = $1
      ),
      ranked AS (
        SELECT id,
          ROW_NUMBER() OVER (
            ORDER BY
              CASE
                WHEN total_trades = 0 THEN NULL
                ELSE
                    "avgTestScore"
                    * (0.6 + 0.4 * "consistencyScore" / 100)
                    * GREATEST(0.5, 1.0 - 0.1 * "overfittingWindows")
                    * LEAST(1.0, total_trades::float / ${MIN_TOTAL_TRADES})
              END
              DESC NULLS LAST
          ) AS new_rank
        FROM totals
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
