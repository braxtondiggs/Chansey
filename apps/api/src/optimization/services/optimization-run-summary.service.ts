import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { OptimizationResult } from '../entities/optimization-result.entity';
import { OptimizationRunSummary } from '../entities/optimization-run-summary.entity';
import { OptimizationRun } from '../entities/optimization-run.entity';

@Injectable()
export class OptimizationRunSummaryService {
  private readonly logger = new Logger(OptimizationRunSummaryService.name);

  constructor(
    @InjectRepository(OptimizationRunSummary) private readonly summaryRepo: Repository<OptimizationRunSummary>,
    @InjectRepository(OptimizationRun) private readonly runRepo: Repository<OptimizationRun>,
    @InjectRepository(OptimizationResult) private readonly resultRepo: Repository<OptimizationResult>
  ) {}

  async computeAndPersist(runId: string): Promise<void> {
    const run = await this.runRepo.findOne({ where: { id: runId } });
    if (!run) {
      this.logger.warn(`Optimization run ${runId} not found — skipping summary`);
      return;
    }

    const row = await this.resultRepo
      .createQueryBuilder('res')
      .select('COUNT(*)', 'resultCount')
      .addSelect('AVG(res."avgTrainScore")', 'avgTrainScore')
      .addSelect('AVG(res."avgTestScore")', 'avgTestScore')
      .addSelect('AVG(res."avgDegradation")', 'avgDegradation')
      .addSelect('AVG(res."consistencyScore")', 'avgConsistency')
      .addSelect('COUNT(*) FILTER (WHERE res."overfittingWindows" > 0)', 'overfittingCount')
      .where('res."optimizationRunId" = :runId', { runId })
      .getRawOne<{
        resultCount: string | null;
        avgTrainScore: string | null;
        avgTestScore: string | null;
        avgDegradation: string | null;
        avgConsistency: string | null;
        overfittingCount: string | null;
      }>();

    const resultCount = parseInt(row?.resultCount ?? '0', 10) || 0;
    const overfittingCount = parseInt(row?.overfittingCount ?? '0', 10) || 0;
    const overfittingRate = resultCount > 0 ? overfittingCount / resultCount : null;

    const summary: Partial<OptimizationRunSummary> = {
      optimizationRunId: runId,
      combinationsTested: run.combinationsTested ?? 0,
      resultCount,
      overfittingCount,
      bestScore: run.bestScore ?? null,
      improvement: run.improvement ?? null,
      avgTrainScore:
        row?.avgTrainScore !== null && row?.avgTrainScore !== undefined ? parseFloat(row.avgTrainScore) : null,
      avgTestScore: row?.avgTestScore !== null && row?.avgTestScore !== undefined ? parseFloat(row.avgTestScore) : null,
      avgDegradation:
        row?.avgDegradation !== null && row?.avgDegradation !== undefined ? parseFloat(row.avgDegradation) : null,
      avgConsistency:
        row?.avgConsistency !== null && row?.avgConsistency !== undefined ? parseFloat(row.avgConsistency) : null,
      overfittingRate,
      computedAt: new Date()
    };

    await this.summaryRepo.upsert(summary as QueryDeepPartialEntity<OptimizationRunSummary>, {
      conflictPaths: ['optimizationRunId'],
      skipUpdateIfNoValuesChanged: false
    });

    this.logger.debug(
      `Computed optimization run summary for ${runId}: ${resultCount} results, overfitting ${overfittingCount}`
    );
  }
}
