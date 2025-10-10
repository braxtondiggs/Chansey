import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import * as https from 'https';

import { AssetBalanceDto } from '../../balance/dto/balance-response.dto';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class CoinbaseService extends BaseExchangeService {
  protected readonly exchangeSlug = 'coinbase'; // Regular Coinbase's slug
  protected readonly exchangeId: keyof typeof ccxt = 'coinbaseadvanced'; // Note: ccxt uses 'coinbaseadvanced' for Coinbase Advanced Trading
  protected readonly apiKeyConfigName = 'COINBASE_API_KEY';
  protected readonly apiSecretConfigName = 'COINBASE_API_SECRET';

  constructor(
    configService?: ConfigService,

    @Inject(forwardRef(() => ExchangeService)) exchangeService?: ExchangeService,
    @Inject(forwardRef(() => ExchangeKeyService)) exchangeKeyService?: ExchangeKeyService
  ) {
    super(configService, exchangeKeyService, exchangeService);
  }

  /**
   * Get a CCXT Coinbase client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT Coinbase client
   */
  async getCoinbaseClient(user?: User): Promise<ccxt.coinbaseadvanced> {
    return (await this.getClient(user)) as ccxt.coinbaseadvanced;
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
        symbol: symbol,
        price: ticker.last?.toString() || '0',
        timestamp: ticker.timestamp
      };
    } catch (error) {
      this.logger.error(`Error fetching Coinbase price for ${symbol}`, error.stack || error.message);
      throw new Error(`Failed to fetch Coinbase price for ${symbol}`);
    }
  }

  /**
   * Override formatSymbol for regular Coinbase specific formatting
   * @param symbol Raw symbol like "BTCUSD"
   * @returns Formatted symbol
   */
  formatSymbol(symbol: string): string {
    // Coinbase uses different symbol formatting than Coinbase Pro
    return symbol
      .replace('USDT', '/USD')
      .replace(/([A-Z]{3,4})([A-Z]{3,4})/, '$1-$2') // Use dash instead of slash
      .replace('/', '-'); // Convert any slashes to dashes
  }

  /**
   * Override getAdditionalClientConfig for regular Coinbase specific configuration
   */
  protected getAdditionalClientConfig(): object {
    return {
      sandbox: false // Regular Coinbase configuration
    };
  }

  /**
   * Static method to validate Coinbase API keys without requiring an instance
   * @param apiKey - The API key to validate
   * @param secretKey - The secret key to validate
   * @returns true if validation is successful, false otherwise
   */
  static async validateApiKeys(apiKey: string, secretKey: string): Promise<boolean> {
    try {
      // Create HTTP/HTTPS agents that force IPv4 only
      const httpsAgent = new https.Agent({
        family: 4 // Force IPv4
      });

      // Create a temporary Coinbase client with the provided keys
      const client = new ccxt.coinbase({
        apiKey,
        secret: secretKey.replace(/\\n/g, '\n').trim(),
        enableRateLimit: true,
        v3: true, // Use v3 API for Coinbase Pro
        httpsAgent
      });

      // Try to fetch balance - this will throw an error if the keys are invalid
      await client.fetchBalance();
      return true;
    } catch (error) {
      return false;
    }
  }

  async getBalance(user: User): Promise<AssetBalanceDto[]> {
    try {
      const client = await this.getCoinbaseClient(user);
      console.log(`Fetching Coinbase balance for user ${user.id}...`);
      const balances = await client.fetchBalance();
      this.logger.debug(`Fetched Coinbase balance for user ${user.id}: ${JSON.stringify(balances)}`);

      const assetBalances: AssetBalanceDto[] = [];

      for (const [asset, balance] of Object.entries(balances)) {
        if (asset === 'info' || asset === 'free' || asset === 'used' || asset === 'total') {
          continue; // Skip metadata fields
        }

        // const balanceData = balance as { total?: string; free?: string; used?: string };
        if (balance.total && parseFloat(balance.total.toString()) > 0) {
          assetBalances.push({
            asset,
            free: balance.free?.toString() || '0',
            locked: balance.used?.toString() || '0'
          });
        }
      }

      return assetBalances;
    } catch (error) {
      this.logger.error(`Error fetching Coinbase balance for user ${user.id}`, error.stack || error.message);
      return [];
    }
  }
}
