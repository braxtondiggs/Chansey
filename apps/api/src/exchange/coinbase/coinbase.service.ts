import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import * as https from 'https';

import { AssetBalanceDto } from '../../balance/dto/balance-response.dto';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { CCXT_BALANCE_META_KEYS } from '../ccxt-balance.util';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class CoinbaseService extends BaseExchangeService {
  protected readonly exchangeSlug = 'coinbase'; // Regular Coinbase's slug
  protected readonly exchangeId: keyof typeof ccxt = 'coinbaseadvanced'; // Note: ccxt uses 'coinbaseadvanced' for Coinbase Advanced Trading
  protected readonly apiKeyConfigName = 'COINBASE_API_KEY';
  protected readonly apiSecretConfigName = 'COINBASE_API_SECRET';
  readonly quoteAsset = 'USD';

  /**
   * Coinbase Advanced supports futures/perpetual trading
   */
  override get supportsFutures(): boolean {
    return true;
  }

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
        timestamp: Number(ticker.timestamp ?? 0)
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching Coinbase price for ${symbol}`, err.stack || err.message);
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
    // Create HTTP/HTTPS agents that force IPv4 only
    const httpsAgent = new https.Agent({
      family: 4 // Force IPv4
    });

    // Create a temporary Coinbase client with the provided keys
    const client = new ccxt.coinbaseadvanced({
      apiKey,
      secret: secretKey.replace(/\\n/g, '\n').trim(),
      enableRateLimit: true,
      sandbox: false,
      httpsAgent
    });

    try {
      // Try to fetch balance - this will throw an error if the keys are invalid
      await client.fetchBalance();
      return true;
    } catch (error: unknown) {
      return false;
    } finally {
      try {
        await client.close();
      } catch {
        /* empty */
      }
    }
  }

  /**
   * Create a futures order on Coinbase Advanced.
   * Coinbase Advanced does not support setMarginMode or setLeverage via API —
   * margin/leverage is managed by the exchange, not user-configurable.
   */
  async createFuturesOrder(
    user: User,
    symbol: string,
    side: 'buy' | 'sell',
    quantity: number,
    leverage: number,
    params?: Record<string, unknown>
  ): Promise<ccxt.Order> {
    if (leverage !== undefined && leverage !== 1) {
      this.logger.debug(
        `Coinbase Advanced: leverage=${leverage} ignored — margin/leverage is managed by the exchange, not user-configurable`
      );
    }

    const exchange = await this.getClient(user);

    return exchange.createMarketOrder(symbol, side, quantity, undefined, {
      ...params
    });
  }

  /**
   * Get open futures positions from Coinbase Advanced
   * @param user User context for client initialization
   * @param symbol Optional symbol filter; if omitted, returns all positions
   * @returns Array of CCXT position objects
   */
  async getFuturesPositions(user: User, symbol?: string): Promise<ccxt.Position[]> {
    const exchange = await this.getClient(user);
    const symbols = symbol ? [symbol] : undefined;
    return exchange.fetchPositions(symbols);
  }

  async getBalance(user: User): Promise<AssetBalanceDto[]> {
    try {
      const client = await this.getCoinbaseClient(user);
      this.logger.log(`Fetching Coinbase balance for user ${user.id}...`);
      const balances = await client.fetchBalance();
      this.logger.debug(`Fetched Coinbase balance for user ${user.id}: ${JSON.stringify(balances)}`);

      const assetBalances: AssetBalanceDto[] = [];

      for (const [asset, balance] of Object.entries(balances)) {
        if (CCXT_BALANCE_META_KEYS.has(asset)) continue;

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
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching Coinbase balance for user ${user.id}`, err.stack || err.message);
      return [];
    }
  }
}
