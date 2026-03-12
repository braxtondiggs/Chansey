import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { getCapitalAllocationForRisk, Role } from '@chansey/api-interfaces';

import { UpdateFuturesEnabledDto, UpdateOpportunitySellingConfigDto, UpdateUserDto } from './dto';
import { User } from './users.entity';
import { UserWithExchanges } from './users.types';

import { CoinService } from '../coin/coin.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import {
  DEFAULT_OPPORTUNITY_SELLING_CONFIG,
  OpportunitySellingUserConfig
} from '../order/interfaces/opportunity-selling.interface';
import { PortfolioType } from '../portfolio/portfolio-type.enum';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Risk } from '../risk/risk.entity';
import { toErrorInfo } from '../shared/error.util';
import { RiskPoolMappingService } from '../strategy/risk-pool-mapping.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>,
    @InjectRepository(Risk)
    private readonly risk: Repository<Risk>,
    private readonly portfolio: PortfolioService,
    private readonly coin: CoinService,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly riskPoolMapping: RiskPoolMappingService
  ) {}

  async create(user: Partial<User>): Promise<UserWithExchanges> {
    try {
      const newUser = this.user.create(user);

      // Set default coin risk level
      const defaultRisk = await this.risk.findOne({
        where: { level: 3 }
      });

      if (defaultRisk) {
        newUser.coinRisk = defaultRisk;
      } else {
        this.logger.warn('Default "Moderate" risk level not found');
      }

      newUser.algoCapitalAllocationPercentage = getCapitalAllocationForRisk(3);

      const savedUser = await this.user.save(newUser);

      this.logger.debug(`User created with ID: ${savedUser.id}`);
      return Object.assign(savedUser, { exchanges: [] });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to create user`, err.stack);
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async update(updateUserDto: UpdateUserDto, user: User) {
    try {
      const updatedUser = await this.updateLocalProfile(updateUserDto, user);
      return this.getProfile(updatedUser);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to update user with ID: ${user.id}`, err.stack);
      throw new InternalServerErrorException('Failed to update user');
    }
  }

  async updateLocalProfile(updateUserDto: UpdateUserDto, user: User): Promise<User> {
    try {
      const { coinRisk, calculationRiskLevel, ...rest } = updateUserDto;
      const updatedUser = this.user.merge(user, rest);
      let riskChanged = false;

      // Handle coinRisk change
      if (coinRisk && user.coinRisk?.id !== coinRisk) {
        updatedUser.coinRisk = await this.getRiskLevel(coinRisk);
        await this.updatePortfolioByUserRisk(updatedUser);
        riskChanged = true;
      }

      // Handle calculationRiskLevel change
      if (calculationRiskLevel !== undefined && user.calculationRiskLevel !== calculationRiskLevel) {
        updatedUser.calculationRiskLevel = calculationRiskLevel;
        riskChanged = true;
      }

      // Only recalculate capital allocation when risk settings change
      if (riskChanged) {
        updatedUser.algoCapitalAllocationPercentage = getCapitalAllocationForRisk(
          updatedUser.effectiveCalculationRiskLevel
        );
      }

      await this.user.save(updatedUser);
      this.logger.debug(`Local profile updated for user ID: ${user.id}`);

      return updatedUser;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to update local profile for user ID: ${user.id}`, err.stack);
      throw new InternalServerErrorException('Failed to update local profile');
    }
  }

  async getById(id: string): Promise<UserWithExchanges> {
    try {
      const user = await this.user.findOneOrFail({ where: { id } });
      const exchanges = await this.exchangeKeyService.getSupportedExchangeKeys(user.id);

      this.logger.debug(`User retrieved with ID: ${id}`);
      return Object.assign(user, { exchanges });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`User not found with ID: ${id}`, err.stack);
      throw new NotFoundException(`User with ID ${id} not found`);
    }
  }

  /**
   * Get exchange keys for a user without fetching user data
   * Useful when caller already has user data and just needs exchange info
   */
  async getExchangeKeysForUser(userId: string) {
    return this.exchangeKeyService.getSupportedExchangeKeys(userId);
  }

  async findAll() {
    try {
      return await this.user.find();
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to retrieve all users`, err.stack);
      throw new InternalServerErrorException('Failed to retrieve users');
    }
  }

  async getProfile(user: User): Promise<UserWithExchanges> {
    try {
      const dbUser = await this.getById(user.id);

      dbUser.roles = user.roles || dbUser.roles || [Role.USER];
      return dbUser;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get user profile: ${user.id}`, err.stack);
      throw new InternalServerErrorException('Failed to retrieve user profile');
    }
  }

  async updatePortfolioByUserRisk(user: User) {
    const portfolio = await this.portfolio.getPortfolioByUser(user);
    const dynamicPortfolio = portfolio.filter((p) => p.type === PortfolioType.AUTOMATIC);

    await Promise.all(dynamicPortfolio.map((portfolio) => this.portfolio.deletePortfolioItem(portfolio.id, user.id)));

    const newCoins = await this.coin.getCoinsByRiskLevel(user, 5);
    await Promise.all(
      newCoins.map((coin) =>
        this.portfolio.createPortfolioItem(
          {
            coinId: coin.id,
            type: PortfolioType.AUTOMATIC
          },
          user
        )
      )
    );
  }

  private async getRiskLevel(riskId: string) {
    try {
      return await this.risk.findOneOrFail({ where: { id: riskId } });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Risk level not found with ID: ${riskId}`, err.stack);
      throw new NotFoundException(`Risk level with ID ${riskId} not found`);
    }
  }

  async getUsersWithActiveExchangeKeys(): Promise<UserWithExchanges[]> {
    try {
      this.logger.debug('Fetching users with active exchange keys');

      const users = await this.user
        .createQueryBuilder('user')
        .innerJoin('exchange_key', 'key', 'key.userId = user.id')
        .where('key.isActive = :isActive', { isActive: true })
        .getMany();

      // Load supported exchange keys for each user in parallel
      const usersWithExchanges = await Promise.all(
        users.map(async (user) => {
          const exchanges = await this.exchangeKeyService.getSupportedExchangeKeys(user.id);
          return Object.assign(user, { exchanges });
        })
      );

      this.logger.debug(`Found ${usersWithExchanges.length} users with active exchange keys`);
      return usersWithExchanges;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch users with active exchange keys: ${err.message}`, err.stack);
      return [];
    }
  }

  async enrollInAlgoTrading(userId: string): Promise<User> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId }, relations: ['coinRisk'] });

      const capitalAllocationPercentage = getCapitalAllocationForRisk(user.effectiveCalculationRiskLevel);

      user.algoTradingEnabled = true;
      user.algoCapitalAllocationPercentage = capitalAllocationPercentage;
      user.algoEnrolledAt = new Date();

      await this.user.save(user);

      this.logger.log(`User ${userId} enrolled in algo trading with ${capitalAllocationPercentage}% allocation`);
      return user;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to enroll user ${userId} in algo trading: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to enroll in algo trading');
    }
  }

  async pauseAlgoTrading(userId: string): Promise<User> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId } });

      user.algoTradingEnabled = false;

      await this.user.save(user);

      this.logger.log(`User ${userId} paused algo trading (positions kept open)`);
      return user;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to pause algo trading for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to pause algo trading');
    }
  }

  async resumeAlgoTrading(userId: string): Promise<User> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId } });

      if (!user.algoCapitalAllocationPercentage || user.algoCapitalAllocationPercentage <= 0) {
        throw new InternalServerErrorException('No capital allocation set. Please set percentage first.');
      }

      user.algoTradingEnabled = true;

      await this.user.save(user);

      this.logger.log(`User ${userId} resumed algo trading`);
      return user;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to resume algo trading for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to resume algo trading');
    }
  }

  async updateAlgoCapital(userId: string, newPercentage: number): Promise<User> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId } });

      user.algoCapitalAllocationPercentage = newPercentage;

      await this.user.save(user);

      this.logger.log(`User ${userId} updated algo capital allocation to ${newPercentage}%`);
      return user;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to update algo capital for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to update capital allocation');
    }
  }

  async getAlgoTradingStatus(userId: string): Promise<any> {
    try {
      const user = await this.user.findOneOrFail({
        where: { id: userId },
        relations: ['coinRisk']
      });

      let activeStrategies = 0;
      if (user.coinRisk) {
        const strategies = await this.riskPoolMapping.getActiveStrategiesForUser(user);
        activeStrategies = strategies.length;
      }

      return {
        enabled: user.algoTradingEnabled,
        capitalAllocationPercentage: user.algoCapitalAllocationPercentage,
        enrolledAt: user.algoEnrolledAt,
        coinRiskLevel: user.coinRisk?.name || 'Not set',
        calculationRiskLevel: user.effectiveCalculationRiskLevel,
        activeStrategies
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get algo trading status for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to get algo trading status');
    }
  }

  async updateFuturesEnabled(userId: string, dto: UpdateFuturesEnabledDto): Promise<{ futuresEnabled: boolean }> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId } });

      user.futuresEnabled = dto.enabled;
      await this.user.save(user);

      this.logger.log(`User ${userId} ${dto.enabled ? 'enabled' : 'disabled'} futures trading`);

      return { futuresEnabled: user.futuresEnabled };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to update futures trading for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to update futures trading');
    }
  }

  async getFuturesEnabled(userId: string): Promise<{ futuresEnabled: boolean }> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId } });
      return { futuresEnabled: user.futuresEnabled };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get futures trading status for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to get futures trading status');
    }
  }

  async updateOpportunitySellingConfig(
    userId: string,
    dto: UpdateOpportunitySellingConfigDto
  ): Promise<{ enabled: boolean; config: User['opportunitySellingConfig'] }> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId } });

      // Merge only the provided config fields into the existing config
      const { enabled, ...configFields } = dto;
      const defined = Object.fromEntries(
        Object.entries(configFields).filter(([, v]) => v !== undefined)
      ) as Partial<OpportunitySellingUserConfig>;
      user.opportunitySellingConfig = {
        ...(user.opportunitySellingConfig ?? DEFAULT_OPPORTUNITY_SELLING_CONFIG),
        ...defined
      };

      if (enabled !== undefined) {
        user.enableOpportunitySelling = enabled;
      }

      await this.user.save(user);

      this.logger.log(`User ${userId} updated opportunity selling config (enabled=${user.enableOpportunitySelling})`);

      return {
        enabled: user.enableOpportunitySelling,
        config: user.opportunitySellingConfig
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to update opportunity selling config for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to update opportunity selling config');
    }
  }

  async getOpportunitySellingConfig(
    userId: string
  ): Promise<{ enabled: boolean; config: User['opportunitySellingConfig'] }> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId } });
      return {
        enabled: user.enableOpportunitySelling,
        config: user.opportunitySellingConfig
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get opportunity selling config for user ${userId}: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Failed to get opportunity selling config');
    }
  }
}
