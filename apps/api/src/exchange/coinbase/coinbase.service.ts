import { forwardRef, Inject, Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { User } from '../../users/users.entity';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class CoinbaseService {
  private readonly logger = new Logger(CoinbaseService.name);
  private readonly coinbaseSlug = 'gdax'; // Coinbase Pro's slug
  private coinbaseClients: Map<string, ccxt.Exchange> = new Map();

  constructor(
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ExchangeKeyService))
    private readonly exchangeKeyService?: ExchangeKeyService,
    @Inject(forwardRef(() => ExchangeService))
    private readonly exchangeService?: ExchangeService
  ) {}

  /**
   * Get a CCXT Coinbase client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT Coinbase client
   */
  async getCoinbaseClient(user?: User): Promise<ccxt.coinbase> {
    if (user && this.exchangeKeyService && this.exchangeService) {
      if (this.coinbaseClients.has(user.id)) {
        return this.coinbaseClients.get(user.id) as ccxt.coinbase;
      }

      try {
        // Get the Coinbase exchange ID
        const coinbaseExchange = await this.exchangeService.findBySlug(this.coinbaseSlug);

        // Get the user's Coinbase keys
        const exchangeKeys = await this.exchangeKeyService.findByExchange(coinbaseExchange.id, user.id);

        // Use the first active key
        const activeKey = exchangeKeys.find((key) => key.isActive);

        if (activeKey && activeKey.decryptedApiKey && activeKey.decryptedSecretKey) {
          const coinbaseClient = new ccxt.coinbase({
            apiKey: activeKey.decryptedApiKey,
            secret: activeKey.decryptedSecretKey.replace(/\\n/g, '\n').trim(),
            enableRateLimit: true
          });

          this.coinbaseClients.set(user.id, coinbaseClient);
          return coinbaseClient;
        }
      } catch (error) {
        this.logger.error(`Failed to get Coinbase client for user ${user.id}`, error);
        // Fall through to default client
      }
    }

    // Return default Coinbase client using app-wide API keys
    const defaultApiKey = this.configService.get<string>('COINBASE_API_KEY');
    const defaultApiSecret = this.configService.get<string>('COINBASE_API_SECRET');

    if (!defaultApiKey || !defaultApiSecret) {
      this.logger.error('Default Coinbase API keys are not set in configuration');
      throw new InternalServerErrorException('Coinbase API keys are not configured');
    }

    // Create or return the default client
    if (!this.coinbaseClients.has('default')) {
      const defaultCoinbaseClient = new ccxt.coinbase({
        apiKey: defaultApiKey,
        secret: defaultApiSecret.replace(/\\n/g, '\n').trim(),
        enableRateLimit: true
      });
      this.coinbaseClients.set('default', defaultCoinbaseClient);
    }

    return this.coinbaseClients.get('default') as ccxt.coinbase;
  }

  /**
   * Create a temporary Coinbase client with the given API keys for validation purposes
   * @param apiKey - The API key to use
   * @param apiSecret - The API secret to use
   * @returns A Coinbase client instance
   */
  async getTemporaryClient(apiKey: string, apiSecret: string): Promise<ccxt.coinbase> {
    try {
      const coinbaseClient = new ccxt.coinbase({
        apiKey,
        secret: apiSecret.replace(/\\n/g, '\n').trim(),
        enableRateLimit: true
      });

      return coinbaseClient;
    } catch (error) {
      this.logger.error('Failed to create temporary Coinbase client', error);
      throw new InternalServerErrorException('Could not create Coinbase client with provided keys');
    }
  }
  /**
   * Get balances for all assets or a specific one
   * @param user The user to fetch balances for
   * @param type The specific asset type to fetch (optional)
   * @returns Array of balances
   */
  async getBalance(user: User, type = 'ALL') {
    try {
      const client = await this.getCoinbaseClient(user);
      const balanceData = await client.fetchBalance({ v3: true });

      const balances = Object.entries(balanceData.total).map(([asset, amount]) => ({
        asset,
        free: balanceData.free[asset]?.toString() || '0',
        locked: balanceData.used[asset]?.toString() || '0'
      }));

      const coin = type.toUpperCase();

      if (coin !== 'ALL') {
        return balances.filter((b) => b.asset === coin);
      }

      return balances.filter((b) => parseFloat(b.free) > 0);
    } catch (error) {
      this.logger.error('Error fetching Coinbase balances', error.stack || error.message);
      throw new InternalServerErrorException('Failed to fetch Coinbase balances');
    }
  }

  /**
   * Get free USD balance from Coinbase
   * @param user The user to get balances for
   * @returns USD balance information
   */
  async getFreeBalance(user: User) {
    try {
      const balances = await this.getBalance(user);
      return balances.filter((b) => (b.asset === 'USD' || b.asset === 'USDC') && parseFloat(b.free) > 0);
    } catch (error) {
      this.logger.error('Error fetching Coinbase free balance', error.stack || error.message);
      throw new InternalServerErrorException('Failed to fetch Coinbase free balance');
    }
  }

  /**
   * Get the current price of an asset pair
   * @param symbol The symbol in format like "BTCUSD"
   * @param user Optional user parameter (for compatibility with Binance interface)
   * @returns The current price as a floating-point number
   */
  async getPriceBySymbol(symbol: string, user?: User) {
    try {
      // Format symbol to CCXT format (BTC/USD instead of BTCUSD)
      const formattedSymbol = symbol
        .replace('USDT', '/USD') // Convert BTCUSDT to BTC/USD
        .replace(/([A-Z]{3,4})([A-Z]{3,4})/, '$1/$2'); // Convert BTCUSD to BTC/USD

      const client = await this.getCoinbaseClient(user);
      const ticker = await client.fetchTicker(formattedSymbol);

      return ticker.last;
    } catch (error) {
      this.logger.error(`Error fetching Coinbase price for ${symbol}`, error.stack || error.message);
      throw new InternalServerErrorException(`Failed to fetch Coinbase price for ${symbol}`);
    }
  }

  /**
   * Get the current price of an asset in the original API format
   * @param symbol Symbol in format like "BTC-USD"
   * @returns Price data in the same format as the original API
   */
  async getPrice(symbol: string) {
    try {
      // Format symbol to CCXT format if it's not already
      const formattedSymbol = symbol.includes('/') ? symbol : symbol.replace('-', '/');

      const client = await this.getCoinbaseClient();
      const ticker = await client.fetchTicker(formattedSymbol);

      // Return in the format expected by existing code
      return {
        data: {
          base: formattedSymbol.split('/')[0],
          currency: formattedSymbol.split('/')[1],
          amount: ticker.last.toString()
        }
      };
    } catch (error) {
      this.logger.error(`Error fetching price for ${symbol}`, error.stack || error.message);
      throw new InternalServerErrorException(`Failed to fetch price for ${symbol}`);
    }
  }

  /**
   * Validates that the provided API keys work with Coinbase
   * @param apiKey - The API key to validate
   * @param apiSecret - The API secret to validate
   * @throws Error if the keys are invalid
   */
  async validateKeys(apiKey: string, apiSecret: string): Promise<void> {
    try {
      console.log(apiKey);
      console.log(apiSecret);
      const client = await this.getTemporaryClient(apiKey, apiSecret);

      // Attempt to fetch balance - this will fail if keys are invalid
      await client.fetchBalance();

      // If we get here, the keys are valid
      return;
    } catch (error) {
      console.log(error);
      this.logger.error('Failed to validate Coinbase API keys', error);

      if (error.message && error.message.includes('auth')) {
        throw new Error('Invalid API credentials');
      } else {
        throw new Error(`Failed to validate Coinbase API keys: ${error.message}`);
      }
    }
  }

  /**
   * Get account information with the balances of all assets
   * @param user User to fetch account info for
   * @returns Account information
   */
  async getAccounts(user?: User) {
    try {
      const client = await this.getCoinbaseClient(user);
      const balance = await client.fetchBalance();

      // Format to match your expected structure
      return {
        data: {
          accounts: Object.entries(balance.total).map(([currency]) => ({
            currency: { code: currency },
            balance: {
              amount: balance.free[currency] || 0,
              currency
            }
          }))
        }
      };
    } catch (error) {
      this.logger.error('Error fetching Coinbase accounts', error.stack || error.message);
      throw new InternalServerErrorException('Failed to fetch Coinbase account information');
    }
  }
}
