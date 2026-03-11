import { Inject, InternalServerErrorException, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import * as http from 'http';
import * as https from 'https';

import { CCXT_BALANCE_META_KEYS } from './ccxt-balance.util';
import { EXCHANGE_KEY_SERVICE, EXCHANGE_SERVICE, IExchangeKeyService, IExchangeService } from './interfaces';

import { AssetBalanceDto } from '../balance/dto/balance-response.dto';
import { toErrorInfo } from '../shared/error.util';
import { withRateLimitRetryThrow } from '../shared/retry.util';
import { User } from '../users/users.entity';

/**
 * Base service for all cryptocurrency exchanges
 * Provides common functionality that can be shared between all exchange implementations
 */
export abstract class BaseExchangeService implements OnModuleDestroy {
  protected readonly logger = new Logger(this.constructor.name);
  protected clients: Map<string, ccxt.Exchange> = new Map();
  private clientLastUsed: Map<string, number> = new Map();
  /** Stale client TTL: 30 minutes */
  private static readonly CLIENT_TTL_MS = 30 * 60 * 1000;
  /** Keys that should never be evicted (long-lived singletons) */
  private static readonly PERMANENT_KEYS = new Set(['default', 'public']);

  // Abstract properties that must be implemented by subclasses
  protected abstract readonly exchangeSlug: string;
  protected abstract readonly exchangeId: keyof typeof ccxt;
  protected abstract readonly apiKeyConfigName: string;
  protected abstract readonly apiSecretConfigName: string;
  abstract readonly quoteAsset: string;

  constructor(
    protected readonly configService?: ConfigService,
    @Inject(EXCHANGE_KEY_SERVICE)
    protected readonly exchangeKeyService?: IExchangeKeyService,
    @Inject(EXCHANGE_SERVICE)
    protected readonly exchangeService?: IExchangeService
  ) {}

  async onModuleDestroy(): Promise<void> {
    const closePromises = [...this.clients.entries()].map(async ([key, client]) => {
      try {
        await client.close();
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to close CCXT client '${key}': ${err.message}`);
      }
    });
    await Promise.allSettled(closePromises);
    this.clients.clear();
    this.clientLastUsed.clear();
  }

  /**
   * Remove and close a single cached client
   */
  protected async removeClient(key: string): Promise<void> {
    const client = this.clients.get(key);
    if (client) {
      try {
        await client.close();
      } catch {
        // Swallow - best-effort cleanup
      }
      this.clients.delete(key);
      this.clientLastUsed.delete(key);
    }
  }

  /**
   * Evict user-specific clients that have been idle longer than CLIENT_TTL_MS.
   * Called lazily at the start of getClient() - no timers needed.
   */
  private evictStaleClients(): void {
    const now = Date.now();
    for (const [key, lastUsed] of this.clientLastUsed) {
      if (BaseExchangeService.PERMANENT_KEYS.has(key)) continue;
      if (now - lastUsed > BaseExchangeService.CLIENT_TTL_MS) {
        const client = this.clients.get(key);
        if (client) {
          client.close().catch((error: unknown) => {
            const err = toErrorInfo(error);
            this.logger.warn(`Best-effort close failed for stale client '${key}': ${err.message}`);
          });
        }
        this.clients.delete(key);
        this.clientLastUsed.delete(key);
        this.logger.debug(`Evicted stale CCXT client '${key}' on ${this.exchangeSlug}`);
      }
    }
  }

  /**
   * Get a CCXT client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT client
   */
  async getClient(user?: User): Promise<ccxt.Exchange> {
    this.evictStaleClients();

    // If no user is provided, return the default client
    if (!user) {
      return this.getDefaultClient();
    }

    // Try to find user-specific API keys for this exchange
    if (this.exchangeKeyService && this.exchangeService) {
      try {
        // Find exchange by slug to get the exchange ID
        const exchangeEntity = await this.exchangeService.findBySlug(this.exchangeSlug);

        if (exchangeEntity) {
          const userExchangeKey = await this.exchangeKeyService.findOneByExchangeId(exchangeEntity.id, user.id);

          const decryptedApi = userExchangeKey?.isActive ? await userExchangeKey.getDecryptedApiKey() : undefined;
          const decryptedSecret = userExchangeKey?.isActive ? await userExchangeKey.getDecryptedSecretKey() : undefined;

          if (decryptedApi && decryptedSecret) {
            // Use user-specific API keys
            const clientKey = `user-${user.id}`;

            if (!this.clients.has(clientKey)) {
              this.logger.debug(`Creating user-specific client for user ${user.id} on ${this.exchangeSlug}`);
              const userClient = this.createClient(
                decryptedApi.replace(/\\n/g, '\n').trim(),
                decryptedSecret.replace(/\\n/g, '\n').trim()
              );
              this.clients.set(clientKey, userClient);
            }

            this.clientLastUsed.set(clientKey, Date.now());
            return this.clients.get(clientKey) as ccxt.Exchange;
          }
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(
          `Failed to get user exchange keys for user ${user.id} on ${this.exchangeSlug}: ${err.message}`
        );
        throw new InternalServerErrorException(`Failed to get exchange keys for ${this.exchangeSlug}`);
      }
    }

    // No fallback - if we reach here, user keys are not available
    this.logger.error(`No valid exchange keys found for user ${user.id} on ${this.exchangeSlug}`);
    throw new InternalServerErrorException(`No valid exchange keys found for ${this.exchangeSlug}`);
  }

  /**
   * Get the default client using app-wide API keys
   * @returns A configured CCXT client with default credentials
   */
  async getDefaultClient(): Promise<ccxt.Exchange> {
    // Create or return the default client
    if (!this.clients.has('default')) {
      if (!this.configService) {
        throw new InternalServerErrorException(`ConfigService is not available in ${this.constructor.name}`);
      }
      const defaultApiKey = this.configService.get<string>(this.apiKeyConfigName);
      const defaultApiSecret = this.configService.get<string>(this.apiSecretConfigName);

      if (!defaultApiKey || !defaultApiSecret) {
        this.logger.error(`Default ${this.constructor.name} API keys are not set in configuration`);
        throw new InternalServerErrorException(`${this.constructor.name} API keys are not configured`);
      }

      const defaultClient = this.createClient(defaultApiKey, defaultApiSecret.replace(/\\n/g, '\n').trim());
      this.clients.set('default', defaultClient);
    }

    return this.clients.get('default') as ccxt.Exchange;
  }

  /**
   * Get a public-only client without API keys
   * Only use for public endpoints (order books, tickers, market data)
   * @returns A CCXT client without authentication
   */
  async getPublicClient(): Promise<ccxt.Exchange> {
    // Create or return the public client
    if (!this.clients.has('public')) {
      this.logger.debug(`Creating public-only client for ${this.exchangeSlug}`);
      const publicClient = this.createPublicClient();
      this.clients.set('public', publicClient);
    }

    return this.clients.get('public') as ccxt.Exchange;
  }

  /**
   * Create a temporary client with the given API keys for validation purposes
   * @param apiKey - The API key to use
   * @param apiSecret - The API secret to use
   * @returns A client instance
   */
  async getTemporaryClient(apiKey: string, apiSecret: string): Promise<ccxt.Exchange> {
    try {
      return this.createClient(apiKey, apiSecret.replace(/\\n/g, '\n').trim());
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to create temporary ${this.constructor.name} client: ${err.message}`, err.stack);
      throw new InternalServerErrorException(`Could not create ${this.constructor.name} client with provided keys`);
    }
  }

  /**
   * Parameters passed to CCXT fetchBalance(). Override in subclass if needed (e.g. { type: 'spot' }).
   */
  protected getFetchBalanceParams(): object | undefined {
    return undefined;
  }

  /**
   * Normalize an asset name returned by CCXT. Override in subclass if needed (e.g. Kraken ZUSD → USD).
   */
  protected normalizeAssetName(asset: string): string {
    return asset;
  }

  /**
   * Get balances for all assets
   * @param user The user to fetch balances for
   * @returns Array of balances
   */
  async getBalance(user: User): Promise<AssetBalanceDto[]> {
    try {
      const client = await this.getClient(user);
      const balanceData = await client.fetchBalance(this.getFetchBalanceParams());

      const assetBalances: AssetBalanceDto[] = [];

      for (const [asset, balance] of Object.entries(balanceData)) {
        if (CCXT_BALANCE_META_KEYS.has(asset)) continue;

        const free = Number(balance.free ?? 0);
        const used = Number(balance.used ?? 0);
        const locked = used > 0 ? used : Math.max(0, Number(balance.total ?? 0) - free);

        if (free > 0 || locked > 0) {
          assetBalances.push({
            asset: this.normalizeAssetName(asset),
            free: free.toString(),
            locked: locked.toString()
          });
        }
      }

      return assetBalances;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching ${this.constructor.name} balances`, err.stack || err.message);
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} balances`);
    }
  }

  /**
   * Get free USD balance
   * @param user The user to get balances for
   * @returns USD balance information
   */
  async getFreeBalance(user: User) {
    try {
      const balances = await this.getBalance(user);
      return balances.filter((b) => (b.asset === 'USD' || b.asset === 'USDC') && parseFloat(b.free) > 0);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching ${this.constructor.name} free balance`, err.stack || err.message);
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} free balance`);
    }
  }

  /**
   * Get the current price of an asset pair
   * @param symbol The symbol in format like "BTCUSD"
   * @param user Optional user parameter
   * @returns The current price as a floating-point number
   */
  async getPriceBySymbol(symbol: string, user?: User) {
    try {
      const formattedSymbol = this.formatSymbol(symbol);
      const client = await this.getClient(user);
      const ticker = await withRateLimitRetryThrow(() => client.fetchTicker(formattedSymbol), {
        logger: this.logger,
        operationName: `fetchTicker(${symbol})`
      });

      return ticker.last ?? 0;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching ${this.constructor.name} price for ${symbol}`, err.stack || err.message);
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} price for ${symbol}`);
    }
  }

  /**
   * Get the current price of an asset pair in standardized format
   * @param symbol The symbol in format like "BTC/USD"
   * @param user Optional user parameter
   * @returns Standardized price response
   */
  async getPrice(symbol: string, user?: User) {
    try {
      const price = await this.getPriceBySymbol(symbol, user);
      return {
        symbol,
        price: (price ?? 0).toString(),
        timestamp: Date.now()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Error fetching ${this.constructor.name} standardized price for ${symbol}`,
        err.stack || err.message
      );
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} price for ${symbol}`);
    }
  }

  /**
   * Validates that the provided API keys work
   * @param apiKey - The API key to validate
   * @param apiSecret - The API secret to validate
   * @throws Error if the keys are invalid
   */
  async validateKeys(apiKey: string, apiSecret: string): Promise<void> {
    const client = await this.getTemporaryClient(apiKey, apiSecret);
    try {
      await withRateLimitRetryThrow(() => client.fetchBalance(), {
        logger: this.logger,
        operationName: 'validateKeys'
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`${this.constructor.name} API key validation failed: ${err.message}`, err.stack);
      throw new InternalServerErrorException(`Invalid ${this.constructor.name} API keys`);
    } finally {
      try {
        await client.close();
      } catch {
        /* empty */
      }
    }
  }

  /**
   * Create a CCXT client instance
   * @param apiKey - The API key
   * @param apiSecret - The API secret
   * @returns A CCXT client instance
   */
  protected createClient(apiKey: string, apiSecret: string): ccxt.Exchange {
    // Get the exchange class dynamically from CCXT
    const ccxtExchanges = ccxt as unknown as Record<string, new (config: object) => ccxt.Exchange>;
    const ExchangeClass = ccxtExchanges[this.exchangeId];

    if (!ExchangeClass || typeof ExchangeClass !== 'function') {
      throw new InternalServerErrorException(`Exchange ${this.exchangeId} not found in CCXT`);
    }

    // Create HTTP/HTTPS agents that force IPv4 only
    const httpAgent = new http.Agent({
      family: 4 // Force IPv4
    });

    const httpsAgent = new https.Agent({
      family: 4 // Force IPv4
    });

    return new ExchangeClass({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      agent: httpsAgent, // Most exchanges use HTTPS
      httpAgent, // Fallback for HTTP
      httpsAgent,
      ...this.getAdditionalClientConfig()
    });
  }

  /**
   * Create a public-only CCXT client instance without API keys
   * @returns A CCXT client instance for public endpoints only
   */
  protected createPublicClient(): ccxt.Exchange {
    // Get the exchange class dynamically from CCXT
    const ccxtExchanges = ccxt as unknown as Record<string, new (config: object) => ccxt.Exchange>;
    const ExchangeClass = ccxtExchanges[this.exchangeId];

    if (!ExchangeClass || typeof ExchangeClass !== 'function') {
      throw new InternalServerErrorException(`Exchange ${this.exchangeId} not found in CCXT`);
    }

    // Create HTTP/HTTPS agents that force IPv4 only
    const httpAgent = new http.Agent({
      family: 4 // Force IPv4
    });

    const httpsAgent = new https.Agent({
      family: 4 // Force IPv4
    });

    // Create client without API keys - only for public endpoints
    return new ExchangeClass({
      enableRateLimit: true,
      agent: httpsAgent,
      httpAgent,
      httpsAgent,
      ...this.getAdditionalClientConfig()
    });
  }

  /**
   * Format symbol for the specific exchange
   * Override in subclasses if needed
   * @param symbol Raw symbol like "BTCUSD" or "BTC/USDT"
   * @returns Formatted symbol
   */
  formatSymbol(symbol: string): string {
    // Ensure symbol is uppercase
    symbol = symbol.toUpperCase();

    // If symbol already contains a slash, return as-is
    if (symbol.includes('/')) {
      return symbol;
    }

    // Default implementation - convert BTCUSD to BTC/USD
    // Handle common patterns like BTCUSD, BTCUSDT, ETHUSDT, etc.
    if (symbol.endsWith('USDT')) {
      const base = symbol.slice(0, -4); // Remove 'USDT'
      if (base.length >= 2) return `${base}/USDT`;
    } else if (symbol.endsWith('USD')) {
      const base = symbol.slice(0, -3); // Remove 'USD'
      if (base.length >= 2) return `${base}/USD`;
    }

    // Fallback: try to split common crypto pairs
    return symbol.replace(/([A-Z]{3,4})([A-Z]{3,4})/, '$1/$2');
  }

  /**
   * Whether this exchange supports futures/perpetual trading.
   * Override in subclass to enable futures functionality.
   */
  get supportsFutures(): boolean {
    return false;
  }

  /**
   * Set the margin mode for a symbol.
   * @param mode Margin mode (e.g. 'isolated', 'cross')
   * @param symbol Trading pair symbol
   * @param user User context for client initialization
   * @throws Error if exchange doesn't support futures
   */
  async setMarginMode(mode: string, symbol: string, _user: User): Promise<void> {
    this.logger.warn(
      `${this.constructor.name} does not support setMarginMode — ignoring (mode=${mode}, symbol=${symbol})`
    );
  }

  /**
   * Set leverage for a symbol.
   * Default is a no-op for exchanges that don't support leverage configuration.
   * Override in subclass to provide real implementation.
   * @param leverage Leverage multiplier
   * @param symbol Trading pair symbol
   * @param user User context for client initialization
   */
  async setLeverage(leverage: number, symbol: string, _user: User): Promise<void> {
    this.logger.warn(
      `${this.constructor.name} does not support setLeverage — ignoring (leverage=${leverage}, symbol=${symbol})`
    );
  }

  /**
   * Create a futures order.
   * Override in subclass to provide real implementation.
   * @throws Error if exchange doesn't support futures
   */
  async createFuturesOrder(
    _user: User,
    _symbol: string,
    _side: 'buy' | 'sell',
    _quantity: number,
    _leverage: number,
    _params?: Record<string, unknown>
  ): Promise<ccxt.Order> {
    throw new Error(`${this.constructor.name} does not support futures trading`);
  }

  /**
   * Get open futures positions.
   * Override in subclass to provide real implementation.
   * @throws Error if exchange doesn't support futures
   */
  async getFuturesPositions(_user: User, _symbol?: string): Promise<ccxt.Position[]> {
    throw new Error(`${this.constructor.name} does not support futures trading`);
  }

  /**
   * Get additional configuration for the client
   * Override in subclasses if needed
   * @returns Additional config object
   */
  protected getAdditionalClientConfig(): object {
    return {};
  }
}
