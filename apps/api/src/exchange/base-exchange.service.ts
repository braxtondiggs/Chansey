import { Inject, InternalServerErrorException, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { CCXT_BALANCE_META_KEYS } from './ccxt-balance.util';
import { createCcxtClient } from './ccxt-client.util';
import { ExchangeClientPool } from './exchange-client-pool';
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
  protected readonly pool = new ExchangeClientPool();

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
    await this.pool.closeAll(this.logger);
  }

  /**
   * Remove and close a single cached client
   */
  protected async removeClient(key: string): Promise<void> {
    await this.pool.remove(key);
  }

  /**
   * Get a CCXT client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT client
   */
  async getClient(user?: User): Promise<ccxt.Exchange> {
    this.pool.evictStale(this.logger, this.exchangeSlug);

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

            if (this.pool.has(clientKey)) {
              this.pool.touch(clientKey);
              return this.pool.get(clientKey) as ccxt.Exchange;
            }

            const pending = this.pool.getPending(clientKey);
            if (pending) {
              return pending;
            }

            const creation = (async () => {
              this.logger.debug(`Creating user-specific client for user ${user.id} on ${this.exchangeSlug}`);
              const userClient = this.createExchangeClient(
                decryptedApi.replace(/\\n/g, '\n').trim(),
                decryptedSecret.replace(/\\n/g, '\n').trim()
              );
              this.pool.set(clientKey, userClient);
              return userClient;
            })();

            this.pool.setPending(clientKey, creation);
            return creation.finally(() => this.pool.deletePending(clientKey));
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
    this.logger.warn(`No valid exchange keys found for user ${user.id} on ${this.exchangeSlug}`);
    throw new InternalServerErrorException(`No valid exchange keys found for ${this.exchangeSlug}`);
  }

  /**
   * Get the default client using app-wide API keys
   * @returns A configured CCXT client with default credentials
   */
  async getDefaultClient(): Promise<ccxt.Exchange> {
    if (this.pool.has('default')) {
      return this.pool.get('default') as ccxt.Exchange;
    }

    const pending = this.pool.getPending('default');
    if (pending) {
      return pending;
    }

    const creation = (async () => {
      if (!this.configService) {
        throw new InternalServerErrorException(`ConfigService is not available in ${this.constructor.name}`);
      }
      const defaultApiKey = this.configService.get<string>(this.apiKeyConfigName);
      const defaultApiSecret = this.configService.get<string>(this.apiSecretConfigName);

      if (!defaultApiKey || !defaultApiSecret) {
        this.logger.error(`Default ${this.constructor.name} API keys are not set in configuration`);
        throw new InternalServerErrorException(`${this.constructor.name} API keys are not configured`);
      }

      const defaultClient = this.createExchangeClient(defaultApiKey, defaultApiSecret.replace(/\\n/g, '\n').trim());
      this.pool.set('default', defaultClient);
      return defaultClient;
    })();

    this.pool.setPending('default', creation);
    return creation.finally(() => this.pool.deletePending('default'));
  }

  /**
   * Get a public-only client without API keys
   * Only use for public endpoints (order books, tickers, market data)
   * @returns A CCXT client without authentication
   */
  async getPublicClient(): Promise<ccxt.Exchange> {
    if (this.pool.has('public')) {
      return this.pool.get('public') as ccxt.Exchange;
    }

    const pending = this.pool.getPending('public');
    if (pending) {
      return pending;
    }

    const creation = (async () => {
      this.logger.debug(`Creating public-only client for ${this.exchangeSlug}`);
      const publicClient = this.createExchangeClient();
      this.pool.set('public', publicClient);
      return publicClient;
    })();

    this.pool.setPending('public', creation);
    return creation.finally(() => this.pool.deletePending('public'));
  }

  /**
   * Create a temporary client with the given API keys for validation purposes
   * @param apiKey - The API key to use
   * @param apiSecret - The API secret to use
   * @returns A client instance
   */
  async getTemporaryClient(apiKey: string, apiSecret: string): Promise<ccxt.Exchange> {
    try {
      return this.createExchangeClient(apiKey, apiSecret.replace(/\\n/g, '\n').trim());
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
   * Assets to include in free balance filtering.
   * Override in subclass to change which assets are considered "free balance" (e.g. ['USD', 'USDT']).
   */
  protected get freeBalanceAssets(): string[] {
    return ['USD', 'USDC'];
  }

  /**
   * When true, getBalance() filters by total > 0 instead of free > 0 || locked > 0.
   * Override in subclass (e.g. Coinbase services).
   */
  protected get balanceFilterByTotal(): boolean {
    return false;
  }

  /**
   * When true, getBalance() returns [] on error instead of throwing.
   * Override in subclass (e.g. Coinbase services).
   */
  protected get balanceSilentOnError(): boolean {
    return false;
  }

  /**
   * Get balances for all assets
   * @param user The user to fetch balances for
   * @returns Array of balances
   */
  async getBalance(user: User): Promise<AssetBalanceDto[]> {
    try {
      const client = await this.getClient(user);
      const balanceData = await withRateLimitRetryThrow(() => client.fetchBalance(this.getFetchBalanceParams()), {
        logger: this.logger,
        operationName: 'getBalance'
      });

      const assetBalances: AssetBalanceDto[] = [];

      for (const [asset, balance] of Object.entries(balanceData)) {
        if (CCXT_BALANCE_META_KEYS.has(asset)) continue;

        const free = Number(balance.free ?? 0);
        const used = Number(balance.used ?? 0);
        const total = Number(balance.total ?? 0);
        const locked = used > 0 ? used : Math.max(0, total - free);

        if (this.balanceFilterByTotal ? total > 0 : free > 0 || locked > 0) {
          assetBalances.push({
            asset: this.normalizeAssetName(asset),
            free: free.toString(),
            locked: locked.toString()
          });
        }
      }

      return assetBalances;
    } catch (error: unknown) {
      if (this.balanceSilentOnError) {
        const err = toErrorInfo(error);
        this.logger.error(`Error fetching ${this.constructor.name} balances`, err.stack || err.message);
        return [];
      }
      const err = toErrorInfo(error);
      this.logger.warn(`Error fetching ${this.constructor.name} balances`, err.stack || err.message);
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
      const client = await this.getClient(user);
      const balanceData = await withRateLimitRetryThrow(() => client.fetchBalance(this.getFetchBalanceParams()), {
        logger: this.logger,
        operationName: 'getFreeBalance'
      });

      const balances: AssetBalanceDto[] = [];
      const allowedAssets = this.freeBalanceAssets;

      for (const [asset, balance] of Object.entries(balanceData)) {
        if (CCXT_BALANCE_META_KEYS.has(asset)) continue;

        const normalized = this.normalizeAssetName(asset);
        if (!allowedAssets.includes(normalized)) continue;

        const free = Number(balance.free ?? 0);
        if (free > 0) {
          const total = Number(balance.total ?? 0);
          const locked = balance.used != null ? Number(balance.used) : Math.max(0, total - free);
          balances.push({ asset: normalized, free: free.toString(), locked: locked.toString() });
        }
      }

      return balances;
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
      const formattedSymbol = this.formatSymbol(symbol);
      const client = await this.getClient(user);
      const ticker = await withRateLimitRetryThrow(() => client.fetchTicker(formattedSymbol), {
        logger: this.logger,
        operationName: `getPrice(${symbol})`
      });

      return {
        symbol,
        price: (ticker.last ?? 0).toString(),
        timestamp: ticker.timestamp ?? Date.now()
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
   * Create a CCXT client instance, optionally with credentials.
   * Delegates to the shared createCcxtClient utility.
   */
  protected createExchangeClient(apiKey?: string, apiSecret?: string): ccxt.Exchange {
    return createCcxtClient(this.exchangeId, {
      apiKey,
      secret: apiSecret,
      additionalConfig: this.getAdditionalClientConfig()
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
