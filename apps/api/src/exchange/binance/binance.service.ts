import { forwardRef, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import Binance, { Binance as BinanceClient } from 'binance-api-node';

import { User } from '../../users/users.entity';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);
  private binanceClients: Map<string, BinanceClient> = new Map();
  private binanceSlug = 'binance';

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => ExchangeKeyService))
    private readonly exchangeKeyService: ExchangeKeyService,
    @Inject(forwardRef(() => ExchangeService))
    private readonly exchangeService: ExchangeService
  ) {}

  async getBinanceClient(user?: User): Promise<BinanceClient> {
    if (user) {
      if (this.binanceClients.has(user.id)) {
        return this.binanceClients.get(user.id);
      }

      try {
        // Get the Binance exchange ID
        const binanceExchange = await this.exchangeService.findBySlug(this.binanceSlug);

        // Get the user's Binance keys
        const exchangeKeys = await this.exchangeKeyService.findByExchange(binanceExchange.id, user.id);

        // Use the first active key
        const activeKey = exchangeKeys.find((key) => key.isActive);

        if (activeKey && activeKey.decryptedApiKey && activeKey.decryptedSecretKey) {
          const binanceClient = Binance({
            apiKey: activeKey.decryptedApiKey,
            apiSecret: activeKey.decryptedSecretKey,
            httpBase: 'https://api.binance.us'
          });

          this.binanceClients.set(user.id, binanceClient);
          return binanceClient;
        }
      } catch (error) {
        this.logger.error(`Failed to get Binance client for user ${user.id}`, error);
        // Fall through to default client
      }
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
    const binanceClient = await this.getBinanceClient(user);
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
        return accountInfo.balances.filter((b) => b.asset === coin);
      }
      return accountInfo.balances.filter((b) => parseFloat(b.free) > 0);
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch Binance balance');
    }
  }

  async getFreeBalance(user: User) {
    try {
      const accountInfo = await this.getBinanceAccountInfo(user);
      return accountInfo.balances.filter((b) => (b.asset === 'USD' || b.asset === 'USDT') && parseFloat(b.free) > 0);
    } catch (error) {
      throw new InternalServerErrorException('Failed to fetch Binance free balance');
    }
  }

  async getPriceBySymbol(symbol: string, user?: User) {
    try {
      const binanceClient = await this.getBinanceClient(user);
      const prices = await binanceClient.prices({ symbol });
      return parseFloat(prices[symbol]);
    } catch (error) {
      this.logger.error(`Failed to fetch price for symbol ${symbol}`, error);
      throw new InternalServerErrorException(`Failed to fetch price for symbol ${symbol}`);
    }
  }

  /**
   * Create a temporary Binance client with the given API keys for validation purposes
   * @param apiKey - The API key to use
   * @param apiSecret - The API secret to use
   * @returns A Binance client instance
   */
  async getTemporaryClient(apiKey: string, apiSecret: string): Promise<BinanceClient> {
    try {
      const binanceClient = Binance({
        apiKey,
        apiSecret,
        httpBase: 'https://api.binance.us'
      });

      return binanceClient;
    } catch (error) {
      this.logger.error('Failed to create temporary Binance client', error);
      throw new InternalServerErrorException('Could not create Binance client with provided keys');
    }
  }
}
