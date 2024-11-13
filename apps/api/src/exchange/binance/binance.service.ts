import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Binance, { Binance as BinanceClient } from 'binance-api-node';

import { User } from '../../users/users.entity';

@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);
  private binanceClients: Map<string, BinanceClient> = new Map();
  constructor(private readonly config: ConfigService) {}

  getBinanceClient(user?: User): BinanceClient {
    if (user && user.binanceAPIKey && user.binanceSecretKey) {
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
      throw new InternalServerErrorException('Failed to fetch Binance account information');
    }
  }

  async getBalance(user: User, type = 'ALL') {
    try {
      const accountInfo = await this.getBinanceAccountInfo(user);
      const coin = type.toUpperCase();

      if (coin !== 'ALL') {
        return accountInfo.balances.find((b) => b.asset === coin);
      }
      return accountInfo.balances.filter((b) => parseFloat(b.free) > 0);
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch Binance balance');
    }
  }

  async getFreeBalance(user: User) {
    try {
      const accountInfo = await this.getBinanceAccountInfo(user);
      return accountInfo.balances.find((b) => (b.asset === 'USD' || b.asset === 'USDT') && parseFloat(b.free) > 0);
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch Binance free balance');
    }
  }
}
