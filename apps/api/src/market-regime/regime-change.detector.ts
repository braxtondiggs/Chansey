import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { MarketRegimeType, RegimeChangeImpact, DeploymentStatus } from '@chansey/api-interfaces';

import { Deployment } from '../strategy/entities/deployment.entity';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';

/**
 * Regime Change Detector
 * Detects market regime changes and assesses impact on active strategies
 */
@Injectable()
export class RegimeChangeDetector {
  private readonly logger = new Logger(RegimeChangeDetector.name);

  constructor(
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>
  ) {}

  /**
   * Detect impact of regime change on active strategies
   */
  async detectImpact(
    fromRegime: MarketRegimeType,
    toRegime: MarketRegimeType,
    asset: string
  ): Promise<RegimeChangeImpact> {
    // Calculate severity of change
    const severity = this.calculateSeverity(fromRegime, toRegime);

    // Find affected strategies
    const affectedStrategies = await this.findAffectedStrategies(asset, toRegime);

    // Generate recommendations
    const recommendedActions = this.generateRecommendations(fromRegime, toRegime, affectedStrategies.length);

    // Generate description
    const description = this.generateDescription(fromRegime, toRegime, severity);

    return {
      affectedStrategies: affectedStrategies.map((s) => s.id),
      recommendedActions,
      severity,
      description
    };
  }

  /**
   * Calculate severity of regime change
   */
  private calculateSeverity(fromRegime: MarketRegimeType, toRegime: MarketRegimeType): 'low' | 'medium' | 'high' {
    // Map regimes to severity levels
    const regimeLevels = {
      [MarketRegimeType.LOW_VOLATILITY]: 1,
      [MarketRegimeType.NORMAL]: 2,
      [MarketRegimeType.HIGH_VOLATILITY]: 3,
      [MarketRegimeType.EXTREME]: 4
    };

    const levelDiff = Math.abs(regimeLevels[toRegime] - regimeLevels[fromRegime]);

    if (levelDiff >= 3) return 'high'; // LOW → EXTREME or vice versa
    if (levelDiff === 2) return 'medium'; // e.g., LOW → HIGH
    return 'low'; // Adjacent regimes
  }

  /**
   * Find strategies that may be affected by regime change
   */
  private async findAffectedStrategies(asset: string, newRegime: MarketRegimeType): Promise<StrategyConfig[]> {
    // Get all active deployments
    const activeDeployments = await this.deploymentRepo.find({
      where: { status: DeploymentStatus.ACTIVE },
      relations: ['strategyConfig']
    });

    // Filter strategies that may not perform well in new regime
    const affectedStrategies: StrategyConfig[] = [];

    for (const deployment of activeDeployments) {
      const shouldFlag = this.shouldFlagStrategy(deployment.strategyConfig, newRegime);

      if (shouldFlag) {
        affectedStrategies.push(deployment.strategyConfig);
      }
    }

    return affectedStrategies;
  }

  /**
   * Determine if strategy should be flagged for regime change
   */
  private shouldFlagStrategy(strategy: StrategyConfig, newRegime: MarketRegimeType): boolean {
    // Heuristics for strategy vulnerability to regime changes
    // This is simplified - in production, use historical performance by regime

    const params = strategy.parameters;

    // Mean reversion strategies struggle in trending (high volatility) markets
    if (params.strategyType === 'mean-reversion' && newRegime === MarketRegimeType.HIGH_VOLATILITY) {
      return true;
    }

    // Momentum strategies struggle in choppy (normal) markets
    if (params.strategyType === 'momentum' && newRegime === MarketRegimeType.NORMAL) {
      return true;
    }

    // All strategies affected by extreme volatility
    if (newRegime === MarketRegimeType.EXTREME) {
      return true;
    }

    return false;
  }

  /**
   * Generate recommended actions for regime change
   */
  private generateRecommendations(
    fromRegime: MarketRegimeType,
    toRegime: MarketRegimeType,
    affectedCount: number
  ): string[] {
    const recommendations: string[] = [];

    // Transitioning to extreme volatility
    if (toRegime === MarketRegimeType.EXTREME) {
      recommendations.push('Reduce overall position sizes by 50%');
      recommendations.push('Tighten stop losses across all strategies');
      recommendations.push('Consider pausing mean-reversion strategies');
      recommendations.push('Increase monitoring frequency to every 15 minutes');
    }

    // Transitioning to high volatility
    else if (toRegime === MarketRegimeType.HIGH_VOLATILITY) {
      recommendations.push('Reduce position sizes by 25%');
      recommendations.push('Review and adjust stop losses');
      recommendations.push('Monitor drawdown limits closely');
    }

    // Transitioning to normal/low volatility from high
    else if (
      (fromRegime === MarketRegimeType.HIGH_VOLATILITY || fromRegime === MarketRegimeType.EXTREME) &&
      (toRegime === MarketRegimeType.NORMAL || toRegime === MarketRegimeType.LOW_VOLATILITY)
    ) {
      recommendations.push('Gradually restore position sizes');
      recommendations.push('Consider activating mean-reversion strategies');
      recommendations.push('Resume standard monitoring schedule');
    }

    // Affected strategies count
    if (affectedCount > 0) {
      recommendations.push(`Review ${affectedCount} flagged strategies for regime suitability`);
    }

    return recommendations;
  }

  /**
   * Generate human-readable description of regime change
   */
  private generateDescription(
    fromRegime: MarketRegimeType,
    toRegime: MarketRegimeType,
    severity: 'low' | 'medium' | 'high'
  ): string {
    const severityText = severity === 'high' ? 'CRITICAL' : severity === 'medium' ? 'SIGNIFICANT' : 'MINOR';

    return `${severityText} regime change: ${this.formatRegimeName(fromRegime)} → ${this.formatRegimeName(
      toRegime
    )}. Market volatility has ${this.getVolatilityDirection(fromRegime, toRegime)}.`;
  }

  /**
   * Format regime name for display
   */
  private formatRegimeName(regime: MarketRegimeType): string {
    const names = {
      [MarketRegimeType.LOW_VOLATILITY]: 'Low Volatility',
      [MarketRegimeType.NORMAL]: 'Normal',
      [MarketRegimeType.HIGH_VOLATILITY]: 'High Volatility',
      [MarketRegimeType.EXTREME]: 'Extreme Volatility'
    };

    return names[regime];
  }

  /**
   * Get volatility direction text
   */
  private getVolatilityDirection(fromRegime: MarketRegimeType, toRegime: MarketRegimeType): string {
    const regimeLevels = {
      [MarketRegimeType.LOW_VOLATILITY]: 1,
      [MarketRegimeType.NORMAL]: 2,
      [MarketRegimeType.HIGH_VOLATILITY]: 3,
      [MarketRegimeType.EXTREME]: 4
    };

    if (regimeLevels[toRegime] > regimeLevels[fromRegime]) {
      return 'increased significantly';
    } else if (regimeLevels[toRegime] < regimeLevels[fromRegime]) {
      return 'decreased significantly';
    }

    return 'remained stable';
  }
}
