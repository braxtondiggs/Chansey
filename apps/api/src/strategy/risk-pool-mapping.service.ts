import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { StrategyConfig } from './entities/strategy-config.entity';

import { Risk } from '../risk/risk.entity';
import { User } from '../users/users.entity';

/**
 * Manages strategy assignment to risk levels and retrieves strategies for users.
 *
 * Direct Risk Level Mapping (1:1):
 * - Risk Level 1 → Strategies assigned to Risk 1 (Ultra Conservative)
 * - Risk Level 2 → Strategies assigned to Risk 2 (Conservative)
 * - Risk Level 3 → Strategies assigned to Risk 3 (Moderate)
 * - Risk Level 4 → Strategies assigned to Risk 4 (Growth)
 * - Risk Level 5 → Strategies assigned to Risk 5 (Aggressive)
 * - Risk Level 6 (Custom) → Defaults to Risk 3 strategies (Moderate)
 */
@Injectable()
export class RiskPoolMappingService {
  constructor(
    @InjectRepository(StrategyConfig)
    private readonly strategyConfigRepo: Repository<StrategyConfig>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Risk)
    private readonly riskRepo: Repository<Risk>
  ) {}

  /**
   * Get the risk ID that strategies should be filtered by for this user.
   * Directly returns user's risk ID (1:1 mapping).
   *
   * @param user - User entity with risk relationship loaded
   * @returns Risk ID to filter strategies by
   */
  async getRiskIdForUser(user: User): Promise<string | null> {
    if (!user.risk) {
      return null;
    }

    // Custom risk (level 6) defaults to Moderate (level 3)
    if (user.risk.level === 6) {
      // TODO: Could make this configurable
      return await this.getRiskIdByLevel(3);
    }

    return user.risk.id;
  }

  /**
   * Helper to get risk ID by level number.
   */
  private async getRiskIdByLevel(level: number): Promise<string | null> {
    const risk = await this.riskRepo.findOne({ where: { level } });
    return risk?.id || null;
  }

  /**
   * Gets all active (live) strategies assigned to a user's risk level.
   * Only returns strategies with shadowStatus = 'live' that have passed promotion gates.
   *
   * @param user - User entity with risk relationship loaded
   * @returns Array of StrategyConfig entities ready for live trading
   */
  async getActiveStrategiesForUser(user: User): Promise<StrategyConfig[]> {
    const riskId = await this.getRiskIdForUser(user);

    if (!riskId) {
      return [];
    }

    return this.strategyConfigRepo.find({
      where: {
        shadowStatus: 'live',
        riskPoolId: riskId
      },
      relations: ['riskPool'],
      order: {
        createdAt: 'DESC'
      }
    });
  }

  /**
   * Gets all active strategies for a specific risk ID.
   * Used by admin dashboard and statistics.
   *
   * @param riskId - The risk ID
   * @returns Array of StrategyConfig entities
   */
  async getActiveStrategiesForRisk(riskId: string): Promise<StrategyConfig[]> {
    return this.strategyConfigRepo.find({
      where: {
        shadowStatus: 'live',
        riskPoolId: riskId
      },
      relations: ['riskPool'],
      order: {
        createdAt: 'DESC'
      }
    });
  }

  /**
   * Gets all strategies for a risk level regardless of status (for admin dashboard).
   *
   * @param riskId - The risk ID
   * @returns All strategies assigned to this risk level
   */
  async getAllStrategiesForRisk(riskId: string): Promise<StrategyConfig[]> {
    return this.strategyConfigRepo.find({
      where: {
        riskPoolId: riskId
      },
      relations: ['riskPool'],
      order: {
        shadowStatus: 'ASC',
        createdAt: 'DESC'
      }
    });
  }

  /**
   * Gets count of live strategies per risk level.
   * Useful for monitoring strategy distribution across risk levels.
   *
   * @returns Map of risk ID to strategy count
   */
  async getRiskStrategyCounts(): Promise<Map<string, number>> {
    const allRisks = await this.riskRepo.find();
    const counts = new Map<string, number>();

    for (const risk of allRisks) {
      const count = await this.strategyConfigRepo.count({
        where: {
          shadowStatus: 'live',
          riskPoolId: risk.id
        }
      });
      counts.set(risk.id, count);
    }

    return counts;
  }

  /**
   * Helper method to get users enrolled in algo trading for a specific risk level.
   * Useful for admin dashboard statistics.
   *
   * @param riskId - The risk ID
   * @returns Array of users with this risk level
   */
  async getUsersForRisk(riskId: string): Promise<User[]> {
    return this.userRepo.find({
      where: {
        algoTradingEnabled: true,
        risk: {
          id: riskId
        }
      },
      relations: ['risk'],
      order: {
        algoEnrolledAt: 'DESC'
      }
    });
  }

  /**
   * Get all risk levels from the database.
   * Used for iteration in statistics and admin views.
   */
  async getAllRisks(): Promise<Risk[]> {
    return this.riskRepo.find({
      order: {
        level: 'ASC'
      }
    });
  }
}
