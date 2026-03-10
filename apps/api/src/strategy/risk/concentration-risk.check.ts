import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ConcentrationCheckService } from './concentration-check.service';
import { IRiskCheck, RiskCheckResult } from './risk-check.interface';

import { BalanceService } from '../../balance/balance.service';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { ConcentrationGateService } from '../concentration-gate.service';
import { Deployment } from '../entities/deployment.entity';
import { PerformanceMetric } from '../entities/performance-metric.entity';

/**
 * ConcentrationRiskCheck
 *
 * Risk Check 6: Portfolio Concentration Detection
 * Monitors whether any single asset exceeds the concentration limit
 * for the user's risk level. Runs hourly as part of risk evaluation.
 *
 * Does NOT auto-demote — alerts only. Concentration is expected to
 * fluctuate with market moves.
 */
@Injectable()
export class ConcentrationRiskCheck implements IRiskCheck {
  readonly name = 'concentration-risk';
  readonly description = 'Detect if any single asset exceeds concentration limits';
  readonly priority = 6;
  readonly autoDemote = false;

  private readonly logger = new Logger(ConcentrationRiskCheck.name);

  constructor(
    private readonly concentrationCheck: ConcentrationCheckService,
    private readonly concentrationGate: ConcentrationGateService,
    private readonly balanceService: BalanceService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>
  ) {}

  async evaluate(
    deployment: Deployment,
    _latestMetric: PerformanceMetric | null,
    _historicalMetrics?: PerformanceMetric[]
  ): Promise<RiskCheckResult> {
    try {
      const userId = deployment.strategyConfig?.createdBy;
      if (!userId) {
        return {
          checkName: this.name,
          passed: true,
          actualValue: 'N/A',
          threshold: 'N/A',
          severity: 'low',
          message: 'No user associated with deployment strategy config'
        };
      }

      const user = await this.userRepo.findOne({ where: { id: userId } });
      if (!user) {
        return {
          checkName: this.name,
          passed: true,
          actualValue: 'N/A',
          threshold: 'N/A',
          severity: 'low',
          message: 'User not found'
        };
      }

      const balances = await this.balanceService.getUserBalances(user, false);
      const assets = this.concentrationGate.buildAssetAllocations(balances.current);

      if (assets.length === 0) {
        return {
          checkName: this.name,
          passed: true,
          actualValue: 'N/A',
          threshold: 'N/A',
          severity: 'low',
          message: 'No assets with USD value found'
        };
      }

      const riskLevel = user.effectiveCalculationRiskLevel;
      const result = this.concentrationCheck.checkConcentration(assets, riskLevel, deployment.concentrationLimit);

      if (result.breached) {
        const topBreach = result.breaches[0];
        return {
          checkName: this.name,
          passed: false,
          actualValue: `${(topBreach.concentration * 100).toFixed(1)}%`,
          threshold: `${(topBreach.limit * 100).toFixed(1)}%`,
          severity: 'high',
          message: `Concentration breach: ${topBreach.symbol} at ${(topBreach.concentration * 100).toFixed(1)}% exceeds hard limit ${(topBreach.limit * 100).toFixed(1)}%`,
          recommendedAction: 'Consider rebalancing portfolio to reduce single-asset concentration',
          metadata: {
            breaches: result.breaches,
            totalValue: result.totalValue,
            riskLevel
          }
        };
      }

      if (result.warnings.length > 0) {
        const topWarning = result.warnings[0];
        return {
          checkName: this.name,
          passed: true,
          actualValue: `${(topWarning.concentration * 100).toFixed(1)}%`,
          threshold: `${(topWarning.softLimit * 100).toFixed(1)}%`,
          severity: 'medium',
          message: `Concentration warning: ${topWarning.symbol} at ${(topWarning.concentration * 100).toFixed(1)}% exceeds soft limit ${(topWarning.softLimit * 100).toFixed(1)}%`,
          metadata: {
            warnings: result.warnings,
            totalValue: result.totalValue,
            riskLevel
          }
        };
      }

      return {
        checkName: this.name,
        passed: true,
        actualValue: 'within limits',
        threshold: 'N/A',
        severity: 'low',
        message: 'All asset concentrations within acceptable limits'
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Concentration risk check failed: ${err.message}`, err.stack);
      return {
        checkName: this.name,
        passed: false,
        actualValue: 'ERROR',
        threshold: 'N/A',
        severity: 'high',
        message: `Concentration check failed: ${err.message}`
      };
    }
  }
}
