import { forwardRef, Inject, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { ExchangeKeyService } from './exchange-key/exchange-key.service';
import { ExchangeService } from './exchange.service';

import { AssetBalanceDto } from '../balance/dto/balance-response.dto';
import { User } from '../users/users.entity';

/**
 * Base service for all cryptocurrency exchanges
 * Provides common functionality that can be shared between all exchange implementations
 */
export abstract class BaseExchangeService {
  protected readonly logger = new Logger(this.constructor.name);
  protected clients: Map<string, ccxt.Exchange> = new Map(); // Abstract properties that must be implemented by subclasses
  protected abstract readonly exchangeSlug: string;
  protected abstract readonly exchangeId: keyof typeof ccxt;
  protected abstract readonly apiKeyConfigName: string;
  protected abstract readonly apiSecretConfigName: string;

  constructor(
    protected readonly configService?: ConfigService,
    @Inject(forwardRef(() => ExchangeKeyService))
    protected readonly exchangeKeyService?: ExchangeKeyService,
    @Inject(forwardRef(() => ExchangeService))
    protected readonly exchangeService?: ExchangeService
  ) {}

  /**
   * Get a CCXT client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT client
   */
  async getClient(user?: User): Promise<ccxt.Exchange> {
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

          if (
            userExchangeKey &&
            userExchangeKey.isActive &&
            userExchangeKey.decryptedApiKey &&
            userExchangeKey.decryptedSecretKey
          ) {
            // Use user-specific API keys
            const clientKey = `user-${user.id}`;

            if (!this.clients.has(clientKey)) {
              this.logger.debug(`Creating user-specific client for user ${user.id} on ${this.exchangeSlug}`);
              const userClient = this.createClient(
                userExchangeKey.decryptedApiKey.replace(/\\n/g, '\n').trim(),
                userExchangeKey.decryptedSecretKey.replace(/\\n/g, '\n').trim()
              );
              this.clients.set(clientKey, userClient);
            }

            return this.clients.get(clientKey) as ccxt.Exchange;
          }
        }
      } catch (error) {
        this.logger.error(
          `Failed to get user exchange keys for user ${user.id} on ${this.exchangeSlug}: ${error.message}`
        );
        throw new InternalServerErrorException(
          `Failed to get user exchange keys for ${this.exchangeSlug}: ${error.message}`
        );
      }
    }

    // No fallback - if we reach here, user keys are not available
    this.logger.error(`No valid exchange keys found for user ${user.id} on ${this.exchangeSlug}`);
    throw new InternalServerErrorException(`No valid exchange keys found for user ${user.id} on ${this.exchangeSlug}`);
  }

  /**
   * Get the default client using app-wide API keys
   * @returns A configured CCXT client with default credentials
   */
  async getDefaultClient(): Promise<ccxt.Exchange> {
    // Create or return the default client
    if (!this.clients.has('default')) {
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
   * Create a temporary client with the given API keys for validation purposes
   * @param apiKey - The API key to use
   * @param apiSecret - The API secret to use
   * @returns A client instance
   */
  async getTemporaryClient(apiKey: string, apiSecret: string): Promise<ccxt.Exchange> {
    try {
      return this.createClient(apiKey, apiSecret.replace(/\\n/g, '\n').trim());
    } catch (error) {
      this.logger.error(`Failed to create temporary ${this.constructor.name} client`, error);
      throw new InternalServerErrorException(`Could not create ${this.constructor.name} client with provided keys`);
    }
  }

  /**
   * Get balances for all assets or a specific one
   * @param user The user to fetch balances for
   * @returns Array of balances
   */
  abstract getBalance(user: User): Promise<AssetBalanceDto[]>;

  /**
   * Get free USD balance
   * @param user The user to get balances for
   * @returns USD balance information
   */
  async getFreeBalance(user: User) {
    try {
      const balances = await this.getBalance(user);
      return balances.filter((b) => (b.asset === 'USD' || b.asset === 'USDC') && parseFloat(b.free) > 0);
    } catch (error) {
      this.logger.error(`Error fetching ${this.constructor.name} free balance`, error.stack || error.message);
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
      const ticker = await client.fetchTicker(formattedSymbol);

      return ticker.last;
    } catch (error) {
      this.logger.error(`Error fetching ${this.constructor.name} price for ${symbol}`, error.stack || error.message);
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
        price: price.toString(),
        timestamp: Date.now()
      };
    } catch (error) {
      this.logger.error(
        `Error fetching ${this.constructor.name} standardized price for ${symbol}`,
        error.stack || error.message
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
    try {
      const client = await this.getTemporaryClient(apiKey, apiSecret);
      await client.fetchBalance();
    } catch (error) {
      this.logger.error(`${this.constructor.name} API key validation failed`, error);
      throw new InternalServerErrorException(`Invalid ${this.constructor.name} API keys`);
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

    return new ExchangeClass({
      apiKey,
      secret: apiSecret,
      enableRateLimit: true,
      ...this.getAdditionalClientConfig()
    });
  }

  /**
   * Format symbol for the specific exchange
   * Override in subclasses if needed
   * @param symbol Raw symbol like "BTCUSD"
   * @returns Formatted symbol
   */
  protected formatSymbol(symbol: string): string {
    // Default implementation - convert BTCUSD to BTC/USD
    return symbol.replace('USDT', '/USD').replace(/([A-Z]{3,4})([A-Z]{3,4})/, '$1/$2');
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
