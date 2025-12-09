import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { IsNull, Not, Repository } from 'typeorm';

import { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';
import { RiskPoolMappingService } from './risk-pool-mapping.service';

import { Risk } from '../risk/risk.entity';
import { User } from '../users/users.entity';

/**
 * Provides statistics and analytics for risk levels.
 * Used by admin dashboard to monitor strategy distribution and user allocation.
 */
@Injectable()
export class PoolStatisticsService {
  private readonly logger = new Logger(PoolStatisticsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Risk)
    private readonly riskRepo: Repository<Risk>,
    @InjectRepository(Deployment)
    private readonly deploymentRepo: Repository<Deployment>,
    @InjectRepository(PerformanceMetric)
    private readonly performanceMetricRepo: Repository<PerformanceMetric>,
    private readonly riskPoolMapping: RiskPoolMappingService
  ) {}

  /**
   * Get statistics for a specific risk level.
   * Includes user count, total capital, average return, and strategy count.
   */
  async getRiskStatistics(riskId: string): Promise<RiskStatistics> {
    try {
      const risk = await this.riskRepo.findOne({ where: { id: riskId } });
      if (!risk) {
        throw new Error(`Risk not found: ${riskId}`);
      }

      // Get users with this risk level
      const users = await this.riskPoolMapping.getUsersForRisk(riskId);

      // Calculate average capital allocation percentage
      const avgAllocationPercentage =
        users.length > 0
          ? users.reduce((sum, user) => sum + Number(user.algoCapitalAllocationPercentage || 0), 0) / users.length
          : 0;

      // Note: Can't calculate total capital without fetching each user's balance
      const totalCapital = 0;
      const avgCapitalPerUser = 0;

      // Get active strategies count
      const strategies = await this.riskPoolMapping.getActiveStrategiesForRisk(riskId);

      // Calculate average return from performance metrics
      const avgReturn = await this.calculateAverageReturnForRisk(strategies.map((s) => s.id));

      return {
        riskId,
        riskName: risk.name,
        riskLevel: risk.level,
        enrolledUsers: users.length,
        totalCapital,
        avgCapitalPerUser,
        activeStrategies: strategies.length,
        avgReturn,
        strategies: strategies.map((s) => ({
          id: s.id,
          name: s.name,
          status: s.shadowStatus
        }))
      };
    } catch (error) {
      this.logger.error(`Failed to get risk statistics for ${riskId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get statistics for all risk levels.
   * Provides overview of entire robo-advisor system.
   */
  async getAllRiskStatistics(): Promise<AllRiskStatistics> {
    try {
      const allRisks = await this.riskPoolMapping.getAllRisks();
      const riskStats: RiskStatistics[] = [];

      for (const risk of allRisks) {
        const stats = await this.getRiskStatistics(risk.id);
        riskStats.push(stats);
      }

      const totalUsers = riskStats.reduce((sum, stat) => sum + stat.enrolledUsers, 0);
      const totalCapital = riskStats.reduce((sum, stat) => sum + stat.totalCapital, 0);
      const totalStrategies = riskStats.reduce((sum, stat) => sum + stat.activeStrategies, 0);

      return {
        risks: riskStats,
        totals: {
          enrolledUsers: totalUsers,
          totalCapital,
          activeStrategies: totalStrategies
        }
      };
    } catch (error) {
      this.logger.error(`Failed to get all risk statistics: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get user distribution across risk levels.
   * Shows percentage of users at each risk level.
   */
  async getUserDistribution(): Promise<RiskDistribution[]> {
    try {
      const allStats = await this.getAllRiskStatistics();
      const totalUsers = allStats.totals.enrolledUsers;

      if (totalUsers === 0) {
        return allStats.risks.map((risk) => ({
          riskId: risk.riskId,
          riskName: risk.riskName,
          riskLevel: risk.riskLevel,
          userCount: 0,
          percentage: 0
        }));
      }

      return allStats.risks.map((risk) => ({
        riskId: risk.riskId,
        riskName: risk.riskName,
        riskLevel: risk.riskLevel,
        userCount: risk.enrolledUsers,
        percentage: (risk.enrolledUsers / totalUsers) * 100
      }));
    } catch (error) {
      this.logger.error(`Failed to get user distribution: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get capital distribution across risk levels.
   * Shows how much capital is allocated to each risk level.
   */
  async getCapitalDistribution(): Promise<RiskDistribution[]> {
    try {
      const allStats = await this.getAllRiskStatistics();
      const totalCapital = allStats.totals.totalCapital;

      if (totalCapital === 0) {
        return allStats.risks.map((risk) => ({
          riskId: risk.riskId,
          riskName: risk.riskName,
          riskLevel: risk.riskLevel,
          userCount: 0,
          capital: 0,
          percentage: 0
        }));
      }

      return allStats.risks.map((risk) => ({
        riskId: risk.riskId,
        riskName: risk.riskName,
        riskLevel: risk.riskLevel,
        userCount: risk.enrolledUsers,
        capital: risk.totalCapital,
        percentage: (risk.totalCapital / totalCapital) * 100
      }));
    } catch (error) {
      this.logger.error(`Failed to get capital distribution: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Calculate average return for strategies in a risk level.
   * Uses latest performance metrics from active deployments.
   * @param strategyIds Array of strategy configuration IDs
   * @returns Average cumulative return as a percentage
   */
  private async calculateAverageReturnForRisk(strategyIds: string[]): Promise<number> {
    if (strategyIds.length === 0) return 0;

    try {
      // Get active deployments for these strategies
      const deployments = await this.deploymentRepo.find({
        where: strategyIds.map((id) => ({
          strategyConfigId: id,
          status: 'active' as any
        }))
      });

      if (deployments.length === 0) return 0;

      // Get the latest performance metric for each deployment
      const returns: number[] = [];
      for (const deployment of deployments) {
        const latestMetric = await this.performanceMetricRepo.findOne({
          where: {
            deploymentId: deployment.id,
            cumulativeReturn: Not(IsNull())
          },
          order: { date: 'DESC' }
        });

        if (latestMetric && latestMetric.cumulativeReturn !== null) {
          returns.push(Number(latestMetric.cumulativeReturn) * 100); // Convert to percentage
        }
      }

      if (returns.length === 0) return 0;

      // Calculate average return
      return returns.reduce((sum, r) => sum + r, 0) / returns.length;
    } catch (error) {
      this.logger.warn(`Failed to calculate average return: ${error.message}`);
      return 0;
    }
  }
}

/**
 * Statistics for a single risk level.
 */
export interface RiskStatistics {
  riskId: string;
  riskName: string;
  riskLevel: number;
  enrolledUsers: number;
  totalCapital: number;
  avgCapitalPerUser: number;
  activeStrategies: number;
  avgReturn: number;
  strategies: {
    id: string;
    name: string;
    status: string;
  }[];
}

/**
 * Statistics for all risk levels combined.
 */
export interface AllRiskStatistics {
  risks: RiskStatistics[];
  totals: {
    enrolledUsers: number;
    totalCapital: number;
    activeStrategies: number;
  };
}

/**
 * Risk level distribution data (users or capital).
 */
export interface RiskDistribution {
  riskId: string;
  riskName: string;
  riskLevel: number;
  userCount: number;
  percentage: number;
  capital?: number;
}
