import { forwardRef, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { User } from '../../users/users.entity';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class BinanceUSService {
  private readonly logger = new Logger(BinanceUSService.name);
  private binanceClients: Map<string, ccxt.binanceus> = new Map();
  private binanceSlug = 'binance_us';

  constructor(
    private readonly config: ConfigService,
    @Inject(forwardRef(() => ExchangeKeyService))
    private readonly exchangeKeyService: ExchangeKeyService,
    @Inject(forwardRef(() => ExchangeService))
    private readonly exchangeService: ExchangeService
  ) {}

  async getBinanceClient(user?: User): Promise<ccxt.binanceus> {
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
          const binanceClient = new ccxt.binanceus({
            apiKey: activeKey.decryptedApiKey,
            secret: activeKey.decryptedSecretKey,
            enableRateLimit: true
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
      const defaultBinanceClient = new ccxt.binanceus({
        apiKey: defaultApiKey,
        secret: defaultApiSecret,
        enableRateLimit: true
      });
      this.binanceClients.set('default', defaultBinanceClient);
    }

    return this.binanceClients.get('default');
  }

  async getBinanceAccountInfo(user: User) {
    const binanceClient = await this.getBinanceClient(user);
    try {
      // Fetch with option to include zero balances
      // This ensures all assets are returned, even if they have a very small value
      const accountInfo = await binanceClient.fetchBalance({
        type: 'spot' // Ensure we're getting spot account balances
      });
      this.logger.debug(`Fetched Binance account info for user: ${user?.id || 'default'}`);
      return accountInfo;
    } catch (error) {
      this.logger.error('Failed to fetch Binance account information', error);
      throw new InternalServerErrorException('Failed to fetch Binance account information');
    }
  }

  async getBalance(user: User, type = 'ALL') {
    try {
      const accountInfo = await this.getBinanceAccountInfo(user);
      const coin = type.toUpperCase();

      // Get regular balances
      const balance = Object.entries(accountInfo.total).map(([asset, total]) => {
        const free = accountInfo.free[asset]?.toString() || '0';
        const locked = (parseFloat(total.toString()) - parseFloat(free)).toString();
        return {
          asset,
          free,
          locked
        };
      });

      if (coin !== 'ALL') {
        return balance.filter((b) => b.asset === coin);
      }

      // Return assets that have either free or locked balance greater than zero
      return balance.filter((b) => {
        const freeAmount = parseFloat(b.free);
        const lockedAmount = parseFloat(b.locked);
        return freeAmount > 0 || lockedAmount > 0;
      });
    } catch (error) {
      this.logger.error('Failed to fetch Binance balance', error);
      throw new InternalServerErrorException('Failed to fetch Binance balance');
    }
  }

  async getFreeBalance(user: User) {
    try {
      const accountInfo = await this.getBinanceAccountInfo(user);

      // Transform to match original format and filter for USD/USDT
      const balances = Object.entries(accountInfo.free)
        .filter(([asset, amount]) => (asset === 'USD' || asset === 'USDT') && parseFloat(amount.toString()) > 0)
        .map(([asset, free]) => ({
          asset,
          free: free.toString(),
          locked: (parseFloat(accountInfo.total[asset]?.toString() || '0') - parseFloat(free.toString())).toString()
        }));

      return balances;
    } catch (error) {
      this.logger.error('Failed to fetch Binance free balance', error);
      throw new InternalServerErrorException('Failed to fetch Binance free balance');
    }
  }

  async getPriceBySymbol(symbol: string, user?: User) {
    try {
      const binanceClient = await this.getBinanceClient(user);
      // CCXT expects symbols in format like 'BTC/USDT'
      const formattedSymbol = symbol.includes('/') ? symbol : symbol.replace(/([A-Z0-9]{3,})([A-Z0-9]{3,})$/, '$1/$2');
      const ticker = await binanceClient.fetchTicker(formattedSymbol);
      return ticker.last;
    } catch (error) {
      this.logger.error(`Failed to fetch price for symbol ${symbol}`, error);
      throw new InternalServerErrorException(`Failed to fetch price for symbol ${symbol}`);
    }
  }

  /**
   * Create a temporary Binance client with the given API keys for validation purposes
   * @param apiKey - The API key to use
   * @param apiSecret - The API secret to use
   * @returns A CCXT Binance.US exchange client instance
   */
  async getTemporaryClient(apiKey: string, apiSecret: string): Promise<ccxt.binanceus> {
    try {
      const binanceClient = new ccxt.binanceus({
        apiKey,
        secret: apiSecret,
        enableRateLimit: true
      });

      return binanceClient;
    } catch (error) {
      this.logger.error('Failed to create temporary Binance client', error);
      throw new InternalServerErrorException('Could not create Binance client with provided keys');
    }
  }
}
