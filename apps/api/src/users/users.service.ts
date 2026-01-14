import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UpdateUserDto } from './dto';
import { User } from './users.entity';

import { CoinService } from '../coin/coin.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { PortfolioType } from '../portfolio/portfolio-type.enum';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Risk } from '../risk/risk.entity';
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

  async create(user: Partial<User>) {
    try {
      if (!user.id) throw new InternalServerErrorException('User ID is required');

      const newUser = this.user.create(user);

      // Set default risk level
      const defaultRisk = await this.risk.findOne({
        where: { level: 3 }
      });

      if (defaultRisk) {
        newUser.risk = defaultRisk;
      } else {
        this.logger.warn('Default "Moderate" risk level not found');
      }

      await this.user.save(newUser);

      const savedUser = await this.getById(user.id);

      this.logger.debug(`User created with ID: ${user.id}`);
      return savedUser;
    } catch (error) {
      this.logger.error(`Failed to create user with ID: ${user?.id}`, error.stack);
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async update(updateUserDto: UpdateUserDto, user: User) {
    try {
      const updatedUser = await this.updateLocalProfile(updateUserDto, user);
      return this.getProfile(updatedUser);
    } catch (error) {
      this.logger.error(`Failed to update user with ID: ${user.id}`, error.stack);
      throw new InternalServerErrorException('Failed to update user');
    }
  }

  async updateLocalProfile(updateUserDto: UpdateUserDto, user: User): Promise<User> {
    try {
      const { risk, ...rest } = updateUserDto;
      const updatedUser = this.user.merge(user, rest);

      if (risk && user.risk?.id !== risk) {
        updatedUser.risk = await this.getRiskLevel(risk);
      }

      // Handle risk update separately
      if (updateUserDto.risk && user.risk?.id !== updateUserDto.risk) {
        updatedUser.risk = await this.getRiskLevel(updateUserDto.risk);
        await this.updatePortfolioByUserRisk(updatedUser);
      }

      await this.user.save(updatedUser);
      this.logger.debug(`Local profile updated for user ID: ${user.id}`);

      return updatedUser;
    } catch (error) {
      this.logger.error(`Failed to update local profile for user ID: ${user.id}`, error.stack);
      throw new InternalServerErrorException('Failed to update local profile');
    }
  }

  async getById(id: string, top_level = false): Promise<User> {
    try {
      const user = await this.user.findOneOrFail({ where: { id } });
      const exchanges = await this.exchangeKeyService.getSupportedExchangeKeys(user.id, top_level);

      this.logger.debug(`User retrieved with ID: ${id}`);
      return {
        ...user,
        exchanges
      };
    } catch (error) {
      this.logger.error(`User not found with ID: ${id}`, error.stack);
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
    } catch (error) {
      this.logger.error(`Failed to retrieve all users`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve users');
    }
  }

  async getProfile(user: User) {
    try {
      const dbUser = await this.getById(user.id);

      // Get supported exchange keys information
      const exchanges = await this.exchangeKeyService.getSupportedExchangeKeys(user.id);

      return {
        ...dbUser,
        roles: user.roles || dbUser.roles || ['user'],
        exchanges
      };
    } catch (error) {
      this.logger.error(`Failed to get user profile: ${user.id}`, error.stack);
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
    } catch (error) {
      this.logger.error(`Risk level not found with ID: ${riskId}`, error.stack);
      throw new NotFoundException(`Risk level with ID ${riskId} not found`);
    }
  }

  async getUsersWithActiveExchangeKeys(): Promise<User[]> {
    try {
      this.logger.debug('Fetching users with active exchange keys');

      const users = await this.user
        .createQueryBuilder('user')
        .innerJoin('exchange_key', 'key', 'key.userId = user.id')
        .where('key.isActive = :isActive', { isActive: true })
        .getMany();

      this.logger.debug(`Found ${users.length} users with active exchange keys`);
      return users;
    } catch (error) {
      this.logger.error(`Failed to fetch users with active exchange keys: ${error.message}`, error.stack);
      return [];
    }
  }

  async enrollInAlgoTrading(userId: string, capitalAllocationPercentage: number, exchangeKeyId: string): Promise<User> {
    try {
      const user = await this.user.findOneOrFail({ where: { id: userId }, relations: ['risk'] });

      const exchangeKey = await this.exchangeKeyService.findOne(exchangeKeyId, userId);
      if (!exchangeKey) {
        throw new NotFoundException('Exchange key not found');
      }

      user.algoTradingEnabled = true;
      user.algoCapitalAllocationPercentage = capitalAllocationPercentage;
      user.algoEnrolledAt = new Date();

      await this.user.save(user);

      this.logger.log(`User ${userId} enrolled in algo trading with ${capitalAllocationPercentage}% allocation`);
      return user;
    } catch (error) {
      this.logger.error(`Failed to enroll user ${userId} in algo trading: ${error.message}`, error.stack);
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
    } catch (error) {
      this.logger.error(`Failed to pause algo trading for user ${userId}: ${error.message}`, error.stack);
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
    } catch (error) {
      this.logger.error(`Failed to resume algo trading for user ${userId}: ${error.message}`, error.stack);
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
    } catch (error) {
      this.logger.error(`Failed to update algo capital for user ${userId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to update capital allocation');
    }
  }

  async getAlgoTradingStatus(userId: string): Promise<any> {
    try {
      const user = await this.user.findOneOrFail({
        where: { id: userId },
        relations: ['risk']
      });

      let activeStrategies = 0;
      if (user.risk) {
        const strategies = await this.riskPoolMapping.getActiveStrategiesForUser(user);
        activeStrategies = strategies.length;
      }

      const exchanges = await this.exchangeKeyService.getSupportedExchangeKeys(user.id);

      return {
        enabled: user.algoTradingEnabled,
        capitalAllocationPercentage: user.algoCapitalAllocationPercentage,
        enrolledAt: user.algoEnrolledAt,
        riskLevel: user.risk?.name || 'Not set',
        activeStrategies,
        exchangeKeyId: exchanges?.[0]?.id || null
      };
    } catch (error) {
      this.logger.error(`Failed to get algo trading status for user ${userId}: ${error.message}`, error.stack);
      throw new InternalServerErrorException('Failed to get algo trading status');
    }
  }
}
