import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateUserDto } from './dto';
import { Risk } from './risk.entity';
import { User } from './users.entity';
import { CoinService } from '../coin/coin.service';
import { PortfolioType } from '../portfolio/portfolio-type.enum';
import { PortfolioService } from '../portfolio/portfolio.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>,
    @InjectRepository(Risk)
    private readonly risk: Repository<Risk>,
    private readonly portfolio: PortfolioService,
    private readonly coin: CoinService
  ) {}

  async create(id: string) {
    try {
      const newUser = this.user.create({ id });
      await this.user.save(newUser);
      this.logger.debug(`User created with ID: ${id}`);
      return newUser;
    } catch (error) {
      this.logger.error(`Failed to create user with ID: ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async update(updateUserDto: UpdateUserDto, user: User) {
    try {
      // Create partial update object with correct types
      const updateData: Partial<User> = {
        binance: updateUserDto.binance,
        binanceSecret: updateUserDto.binanceSecret
      };

      // First merge the basic properties
      const updatedUser = this.user.merge(user, updateData);

      // Handle risk update separately
      if (updateUserDto.risk && user.risk?.id !== updateUserDto.risk) {
        updatedUser.risk = await this.getRiskLevel(updateUserDto.risk);
        await this.updatePortfolioByUserRisk(updatedUser);
      }

      await this.user.save(updatedUser);
      this.logger.debug(`User updated with ID: ${user.id}`);
      return updatedUser;
    } catch (error) {
      this.logger.error(`Failed to update user with ID: ${user.id}`, error.stack);
      throw new InternalServerErrorException('Failed to update user');
    }
  }

  async getById(id: string) {
    try {
      const user = await this.user.findOneOrFail({ where: { id } });
      this.logger.debug(`User retrieved with ID: ${id}`);
      return user;
    } catch (error) {
      this.logger.error(`User not found with ID: ${id}`, error.stack);
      throw new NotFoundException(`User with ID ${id} not found`);
    }
  }

  async findAll() {
    try {
      return await this.user.find();
    } catch (error) {
      this.logger.error(`Failed to retrieve all users`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve users');
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
            coin,
            user,
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
}
