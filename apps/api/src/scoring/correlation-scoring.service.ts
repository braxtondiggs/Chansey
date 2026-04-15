import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Not, IsNull, Repository } from 'typeorm';

import { DeploymentStatus } from '@chansey/api-interfaces';

import { CorrelationCalculator } from '../common/metrics/correlation.calculator';
import { BacktestPerformanceSnapshot } from '../order/backtest/backtest-performance-snapshot.entity';
import { Pipeline } from '../pipeline/entities/pipeline.entity';
import { Deployment } from '../strategy/entities/deployment.entity';
import { PerformanceMetric } from '../strategy/entities/performance-metric.entity';

/** Minimum overlapping data points for a statistically meaningful correlation */
const MIN_OVERLAP = 10;

/** How many days of deployment performance to consider */
const LOOKBACK_DAYS = 90;

@Injectable()
export class CorrelationScoringService {
  private readonly logger = new Logger(CorrelationScoringService.name);

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    @InjectRepository(BacktestPerformanceSnapshot)
    private readonly snapshotRepo: Repository<BacktestPerformanceSnapshot>,
    @InjectRepository(Pipeline)
    private readonly pipelineRepo: Repository<Pipeline>,
    private readonly correlationCalculator: CorrelationCalculator
  ) {}

  /**
   * Calculate the maximum absolute correlation between a candidate strategy
   * and all currently active deployments.
   *
   * Returns 0 if there are no active deployments (first strategy),
   * if the candidate has no backtest snapshots, or if no pair has
   * enough overlapping data points.
   */
  async calculateMaxCorrelation(strategyConfigId: string, userId: string): Promise<number> {
    const activeDeployments = await this.deploymentRepo.find({
      where: {
        status: DeploymentStatus.ACTIVE,
        strategyConfigId: Not(strategyConfigId),
        strategyConfig: { createdBy: userId }
      },
      select: ['id', 'strategyConfigId'],
      relations: ['strategyConfig']
    });

    if (activeDeployments.length === 0) {
      return 0;
    }

    const candidateReturns = await this.getCandidateReturns(strategyConfigId, userId);
    if (candidateReturns.length < MIN_OVERLAP) {
      this.logger.debug(
        `Strategy ${strategyConfigId}: only ${candidateReturns.length} candidate return points, skipping correlation`
      );
      return 0;
    }

    let maxCorrelation = 0;

    for (const deployment of activeDeployments) {
      const deploymentReturns = await this.getDeploymentReturns(deployment.id);
      if (deploymentReturns.length < MIN_OVERLAP) continue;

      // Align series lengths — use shorter length, trim from start
      const minLength = Math.min(candidateReturns.length, deploymentReturns.length);
      if (minLength < MIN_OVERLAP) continue;

      const alignedCandidate = candidateReturns.slice(candidateReturns.length - minLength);
      const alignedDeployment = deploymentReturns.slice(deploymentReturns.length - minLength);

      const correlation = Math.abs(
        this.correlationCalculator.calculatePearsonCorrelation(alignedCandidate, alignedDeployment)
      );

      if (correlation > maxCorrelation) {
        maxCorrelation = correlation;
      }
    }

    return maxCorrelation;
  }

  /**
   * Extract return series from the candidate strategy's most recent completed
   * backtest performance snapshots (via Pipeline → Backtest → Snapshots).
   */
  private async getCandidateReturns(strategyConfigId: string, userId: string): Promise<number[]> {
    // Find the most recent completed pipeline for this strategy that has a historical backtest
    const pipeline = await this.pipelineRepo.findOne({
      where: {
        strategyConfigId,
        user: { id: userId },
        historicalBacktestId: Not(IsNull())
      },
      order: { createdAt: 'DESC' },
      select: ['id', 'historicalBacktestId']
    });

    if (!pipeline?.historicalBacktestId) return [];

    const snapshots = await this.snapshotRepo
      .createQueryBuilder('s')
      .select(['s.portfolioValue', 's.timestamp'])
      .where('s.backtestId = :backtestId', { backtestId: pipeline.historicalBacktestId })
      .orderBy('s.timestamp', 'ASC')
      .getMany();

    if (snapshots.length < 2) return [];

    // Convert portfolio values to returns: (current - previous) / previous
    const returns: number[] = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1].portfolioValue;
      if (prev === 0) continue;
      returns.push((snapshots[i].portfolioValue - prev) / prev);
    }

    return returns;
  }

  /**
   * Extract daily return series from a deployment's PerformanceMetric records.
   */
  private async getDeploymentReturns(deploymentId: string): Promise<number[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - LOOKBACK_DAYS);

    const metrics = await this.performanceMetricRepo
      .createQueryBuilder('pm')
      .select('pm.dailyReturn')
      .where('pm.deploymentId = :deploymentId', { deploymentId })
      .andWhere('pm.date >= :cutoff', { cutoff: cutoffDate.toISOString().split('T')[0] })
      .orderBy('pm.date', 'ASC')
      .getMany();

    return metrics.map((m) => Number(m.dailyReturn));
  }
}
