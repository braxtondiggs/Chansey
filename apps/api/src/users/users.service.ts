import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Authorizer, User as AuthUser } from '@authorizerdev/authorizer-js';
import { Repository } from 'typeorm';

import { UpdateUserDto } from './dto';
import { User } from './users.entity';

import { CoinService } from '../coin/coin.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { PortfolioType } from '../portfolio/portfolio-type.enum';
import { PortfolioService } from '../portfolio/portfolio.service';
import { Risk } from '../risk/risk.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private auth: Authorizer;

  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>,
    @InjectRepository(Risk)
    private readonly risk: Repository<Risk>,
    private readonly portfolio: PortfolioService,
    private readonly coin: CoinService,
    private readonly config: ConfigService,
    private readonly exchangeKeyService: ExchangeKeyService
  ) {
    this.auth = new Authorizer({
      authorizerURL: this.config.get<string>('AUTHORIZER_URL'),
      clientID: this.config.get<string>('AUTHORIZER_CLIENT_ID'),
      redirectURL: this.config.get<string>('AUTHORIZER_REDIRECT_URL')
    });
  }

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

  async update(updateUserDto: UpdateUserDto, user: User, updateAuthorizer = true) {
    try {
      const updatedUser = await this.updateLocalProfile(updateUserDto, user);

      if (updateAuthorizer) await this.updateAuthorizerProfile(updateUserDto, user.token);

      return this.getWithAuthorizerProfile(updatedUser);
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

  async updateAuthorizerProfile(updateUserDto: UpdateUserDto, authorizationToken: string): Promise<void> {
    const authorizerData = {
      email: updateUserDto.email,
      given_name: updateUserDto.given_name,
      family_name: updateUserDto.family_name,
      middle_name: updateUserDto.middle_name,
      nickname: updateUserDto.nickname,
      birthdate: updateUserDto.birthdate
    };

    try {
      const filteredData = Object.fromEntries(Object.entries(authorizerData).filter(([_, v]) => v !== undefined));

      if (Object.keys(filteredData).length > 0) {
        const Authorization = authorizationToken;
        const { errors } = await this.auth.updateProfile(filteredData, { Authorization });

        if (errors.length > 0) {
          this.logger.error(`Failed to update Authorizer profile`, errors);
          throw new InternalServerErrorException('Failed to update Authorizer profile');
        }

        this.logger.debug(`Authorizer profile updated successfully`);
      }
    } catch (error) {
      this.logger.error(`Failed to update Authorizer profile`, error.stack);
      throw new InternalServerErrorException('Failed to update Authorizer profile');
    }
  }

  async getById(id: string) {
    try {
      const user = await this.user.findOneOrFail({ where: { id } });
      const exchanges = await this.exchangeKeyService.hasSupportedExchangeKeys(user.id);

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

  async findAll() {
    try {
      return await this.user.find();
    } catch (error) {
      this.logger.error(`Failed to retrieve all users`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve users');
    }
  }

  async getWithAuthorizerProfile(user: User) {
    try {
      const dbUser = await this.getById(user.id);
      const Authorization = user.token;
      const { data } = await this.auth.getProfile({ Authorization });

      // Get supported exchange keys information
      const exchanges = await this.exchangeKeyService.hasSupportedExchangeKeys(user.id);

      return {
        ...data,
        ...dbUser,
        roles: (user as any).allowed_roles,
        exchanges
      };
    } catch (error) {
      this.logger.error(`Failed to get user with Authorizer profile: ${user.id}`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve user with Authorizer profile');
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
