import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Binance, { Binance as BinanceClient } from 'binance-api-node';
import { Repository } from 'typeorm';

import { UpdateUserDto } from './dto';
import { User } from './users.entity';

@Injectable()
export default class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private binanceClients: Map<string, BinanceClient> = new Map();

  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>,
    private readonly config: ConfigService
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
      const updatedUser = this.user.merge(user, updateUserDto);
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

  getBinanceClient(user?: User): BinanceClient {
    if (user && user.binanceAPIKey && user.binanceSecretKey) {
      // Check if a client for this user already exists
      if (this.binanceClients.has(user.id)) {
        return this.binanceClients.get(user.id);
      }

      const binanceClient = Binance({
        apiKey: user.binanceAPIKey,
        apiSecret: user.binanceSecretKey,
        httpBase: 'https://api.binance.us'
      });

      this.binanceClients.set(user.id, binanceClient);
      return binanceClient;
    }

    // Return default Binance client using app-wide API keys
    const defaultApiKey = this.config.get<string>('BINANCE_API_KEY');
    const defaultApiSecret = this.config.get<string>('BINANCE_API_SECRET');

    if (!defaultApiKey || !defaultApiSecret) {
      this.logger.error('Default Binance API keys are not set in configuration');
      throw new InternalServerErrorException('Binance API keys are not configured');
    }

    // Assuming the default client is shared and singleton
    if (!this.binanceClients.has('default')) {
      const defaultBinanceClient = Binance({
        apiKey: defaultApiKey,
        apiSecret: defaultApiSecret,
        httpBase: 'https://api.binance.us'
      });
      this.binanceClients.set('default', defaultBinanceClient);
    }

    return this.binanceClients.get('default');
  }

  async getBinanceAccountInfo(user: User) {
    const binanceClient = this.getBinanceClient(user);
    try {
      const accountInfo = await binanceClient.accountInfo();
      this.logger.debug(`Fetched Binance account info for user: ${user?.id || 'default'}`);
      return accountInfo;
    } catch (error) {
      this.logger.error(`Failed to fetch Binance account info`, error.stack);
      throw new InternalServerErrorException('Failed to fetch Binance account information');
    }
  }
}
