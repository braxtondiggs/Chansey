import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { CorrelationLimitGate } from './correlation-limit.gate';
import { MaximumDrawdownGate } from './maximum-drawdown.gate';
import { MinimumScoreGate } from './minimum-score.gate';
import { MinimumTradesGate } from './minimum-trades.gate';
import { PortfolioCapacityGate } from './portfolio-capacity.gate';
import { PositiveReturnsGate } from './positive-returns.gate';
import {
  IPromotionGate,
  PromotionGateEvaluation,
  PromotionGateResult,
  PromotionGateContext
} from './promotion-gate.interface';
import { VolatilityCapGate } from './volatility-cap.gate';
import { WFAConsistencyGate } from './wfa-consistency.gate';

import { AuditService } from '../../audit/audit.service';
import { MarketRegimeService } from '../../market-regime/market-regime.service';
import { BacktestRun } from '../entities/backtest-run.entity';
import { Deployment } from '../entities/deployment.entity';
import { StrategyConfig } from '../entities/strategy-config.entity';
import { StrategyScore } from '../entities/strategy-score.entity';

// Import all gate implementations

/**
 * PromotionGateService
 *
 * Orchestrates evaluation of all promotion gates to determine if a strategy
 * is eligible for live trading deployment.
 *
 * Gates are evaluated in priority order. Critical gates must all pass for
 * promotion to be allowed. Non-critical gates generate warnings.
 *
 * All gate evaluations are logged to the audit trail for compliance.
 */
@Injectable()
export class PromotionGateService {
  private readonly logger = new Logger(PromotionGateService.name);
  private readonly gates: IPromotionGate[];

  constructor(
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(StrategyScore)
    private readonly strategyScoreRepo: Repository<StrategyScore>,
    @InjectRepository(BacktestRun)
    private readonly backtestRunRepo: Repository<BacktestRun>,
    private readonly auditService: AuditService,
    private readonly marketRegimeService: MarketRegimeService,
    // Inject all gate implementations
    private readonly minimumScoreGate: MinimumScoreGate,
    private readonly minimumTradesGate: MinimumTradesGate,
    private readonly maximumDrawdownGate: MaximumDrawdownGate,
    private readonly wfaConsistencyGate: WFAConsistencyGate,
    private readonly positiveReturnsGate: PositiveReturnsGate,
    private readonly correlationLimitGate: CorrelationLimitGate,
    private readonly volatilityCapGate: VolatilityCapGate,
    private readonly portfolioCapacityGate: PortfolioCapacityGate
  ) {
    // Register all gates in priority order
    this.gates = [
      this.minimumScoreGate,
      this.minimumTradesGate,
      this.maximumDrawdownGate,
      this.wfaConsistencyGate,
      this.positiveReturnsGate,
      this.correlationLimitGate,
      this.volatilityCapGate,
      this.portfolioCapacityGate
    ].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Evaluate all promotion gates for a strategy
   */
  async evaluateGates(strategyConfigId: string, userId?: string): Promise<PromotionGateEvaluation> {
    this.logger.log(`Evaluating promotion gates for strategy ${strategyConfigId}`);

    // Load required data
    const [strategyConfig, latestScore, latestBacktest, context] = await Promise.all([
      this.loadStrategyConfig(strategyConfigId),
      this.loadLatestScore(strategyConfigId),
      this.loadLatestBacktest(strategyConfigId),
      this.buildGateContext()
    ]);

    if (!latestScore || !latestBacktest) {
      throw new Error('Strategy must have backtest results and score before promotion');
    }

    // Evaluate all gates
    const gateResults: PromotionGateResult[] = [];

    for (const gate of this.gates) {
      try {
        const result = await gate.evaluate(strategyConfig, latestScore, latestBacktest, context);
        gateResults.push(result);

        this.logger.debug(`Gate ${gate.name}: ${result.passed ? 'PASS' : 'FAIL'} - ${result.message}`);
      } catch (error) {
        this.logger.error(`Error evaluating gate ${gate.name}:`, error);
        gateResults.push({
          gateName: gate.name,
          passed: false,
          actualValue: 'ERROR',
          requiredValue: 'N/A',
          message: `Gate evaluation failed: ${error.message}`,
          severity: 'critical'
        });
      }
    }

    // Calculate overall result
    const evaluation = this.calculateEvaluation(gateResults);

    // Log to audit trail
    await this.auditService.createAuditLog({
      eventType: AuditEventType.GATE_EVALUATION,
      entityType: 'StrategyConfig',
      entityId: strategyConfigId,
      userId: userId || 'system',
      beforeState: null,
      afterState: {
        canPromote: evaluation.canPromote,
        gatesPassed: evaluation.gatesPassed,
        gatesFailed: evaluation.gatesFailed,
        failedGates: evaluation.failedGates
      },
      metadata: {
        gateResults,
        score: latestScore.overallScore,
        grade: latestScore.grade
      }
    });

    this.logger.log(
      `Gate evaluation for ${strategyConfigId}: ${evaluation.canPromote ? 'APPROVED' : 'REJECTED'} ` +
        `(${evaluation.gatesPassed}/${evaluation.totalGates} passed)`
    );

    return evaluation;
  }

  /**
   * Calculate overall evaluation from individual gate results
   */
  private calculateEvaluation(gateResults: PromotionGateResult[]): PromotionGateEvaluation {
    const totalGates = gateResults.length;
    const gatesPassed = gateResults.filter((r) => r.passed).length;
    const gatesFailed = totalGates - gatesPassed;

    const failedGates = gateResults.filter((r) => !r.passed).map((r) => r.gateName);

    const criticalFailures = gateResults.filter((r) => !r.passed && r.severity === 'critical');

    const warnings = gateResults.filter((r) => !r.passed && r.severity === 'warning').map((r) => r.message);

    const canPromote = criticalFailures.length === 0;

    let summary: string;
    if (canPromote && gatesFailed === 0) {
      summary = `All ${totalGates} gates passed. Strategy approved for promotion.`;
    } else if (canPromote && warnings.length > 0) {
      summary = `${gatesPassed}/${totalGates} gates passed with ${warnings.length} warnings. Strategy approved with caution.`;
    } else {
      summary = `${criticalFailures.length} critical gates failed. Strategy rejected for promotion.`;
    }

    return {
      canPromote,
      gateResults,
      totalGates,
      gatesPassed,
      gatesFailed,
      failedGates,
      summary,
      warnings
    };
  }

  /**
   * Build context for gate evaluation
   */
  private async buildGateContext(): Promise<PromotionGateContext> {
    // Get all active deployments
    const existingDeployments = await this.deploymentRepo.find({
      where: { status: 'active' as any },
      relations: ['strategyConfig']
    });

    // Calculate total allocation
    const totalAllocation = existingDeployments.reduce((sum, d) => sum + Number(d.allocationPercent), 0);

    // Fetch current market regime for the primary market (BTC as default)
    let currentMarketRegime;
    try {
      const regime = await this.marketRegimeService.getCurrentRegime('BTC');
      currentMarketRegime = regime?.regime;
    } catch (error) {
      this.logger.warn(`Failed to fetch market regime: ${error.message}`);
    }

    return {
      existingDeployments,
      totalAllocation,
      currentMarketRegime
    };
  }

  /**
   * Load strategy configuration
   */
  private async loadStrategyConfig(strategyConfigId: string): Promise<StrategyConfig> {
    // This would use StrategyService in real implementation
    // For now, return a placeholder
    return {} as StrategyConfig;
  }

  /**
   * Load latest score for strategy
   */
  private async loadLatestScore(strategyConfigId: string): Promise<StrategyScore | null> {
    return await this.strategyScoreRepo.findOne({
      where: { strategyConfigId },
      order: { calculatedAt: 'DESC' }
    });
  }

  /**
   * Load latest backtest for strategy
   */
  private async loadLatestBacktest(strategyConfigId: string): Promise<BacktestRun | null> {
    return await this.backtestRunRepo.findOne({
      where: { strategyConfigId },
      order: { createdAt: 'DESC' }
    });
  }

  /**
   * Get all registered gates
   */
  getGates(): IPromotionGate[] {
    return [...this.gates];
  }

  /**
   * Get gate by name
   */
  getGate(name: string): IPromotionGate | undefined {
    return this.gates.find((g) => g.name === name);
  }

  /**
   * Get critical gates only
   */
  getCriticalGates(): IPromotionGate[] {
    return this.gates.filter((g) => g.isCritical);
  }

  /**
   * Get non-critical gates (warnings)
   */
  getWarningGates(): IPromotionGate[] {
    return this.gates.filter((g) => !g.isCritical);
  }
}
