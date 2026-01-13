import { forwardRef, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import * as https from 'https';

import { AssetBalanceDto } from '../../balance/dto/balance-response.dto';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class KrakenService extends BaseExchangeService {
  protected readonly exchangeSlug = 'kraken';
  protected readonly exchangeId: keyof typeof ccxt = 'kraken';
  protected readonly apiKeyConfigName = 'KRAKEN_API_KEY';
  protected readonly apiSecretConfigName = 'KRAKEN_API_SECRET';

  constructor(
    configService?: ConfigService,
    @Inject(forwardRef(() => ExchangeService)) exchangeService?: ExchangeService,
    @Inject(forwardRef(() => ExchangeKeyService)) exchangeKeyService?: ExchangeKeyService
  ) {
    super(configService, exchangeKeyService, exchangeService);
  }

  /**
   * Get a CCXT Kraken client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT Kraken client
   */
  async getKrakenClient(user?: User): Promise<ccxt.kraken> {
    return (await this.getClient(user)) as ccxt.kraken;
  }

  /**
   * Override getBalance to handle Kraken-specific balance fetching
   * @param user The user to fetch balances for
   * @returns Array of balances
   */
  async getBalance(user: User): Promise<AssetBalanceDto[]> {
    try {
      const client = await this.getClient(user);
      const balanceData = await client.fetchBalance();

      const balances = Object.entries(balanceData.total).map(([asset, total]) => {
        const free = balanceData.free[asset]?.toString() || '0';
        const locked = (parseFloat(total.toString()) - parseFloat(free)).toString();
        return {
          asset,
          free,
          locked
        };
      });

      // Return assets that have either free or locked balance greater than zero
      return balances.filter((b) => {
        const freeAmount = parseFloat(b.free);
        const lockedAmount = parseFloat(b.locked);
        return freeAmount > 0 || lockedAmount > 0;
      });
    } catch (error) {
      this.logger.error(`Error fetching ${this.constructor.name} balances`, error.stack || error.message);
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} balances`);
    }
  }

  /**
   * Override getFreeBalance to handle Kraken-specific free balance fetching
   * @param user The user to get balances for
   * @returns USD balance information
   */
  async getFreeBalance(user: User) {
    try {
      const client = await this.getClient(user);
      const balanceData = await client.fetchBalance();

      // Kraken uses ZUSD for USD, also check for regular USD
      const balances = Object.entries(balanceData.free)
        .filter(
          ([asset, amount]) =>
            (asset === 'USD' || asset === 'ZUSD' || asset === 'USDT') && parseFloat(amount.toString()) > 0
        )
        .map(([asset, free]) => ({
          asset: asset === 'ZUSD' ? 'USD' : asset, // Normalize ZUSD to USD
          free: free.toString(),
          locked: (parseFloat(balanceData.total[asset]?.toString() || '0') - parseFloat(free.toString())).toString()
        }));

      return balances;
    } catch (error) {
      this.logger.error(`Error fetching ${this.constructor.name} free balance`, error.stack || error.message);
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} free balance`);
    }
  }

  /**
   * Static method to validate Kraken API keys without requiring an instance
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

      // Create a temporary Kraken client with the provided keys
      const client = new ccxt.kraken({
        apiKey,
        secret: secretKey.replace(/\\n/g, '\n').trim(),
        enableRateLimit: true,
        httpsAgent
      });

      // Try to fetch balance - this will throw an error if the keys are invalid
      await client.fetchBalance();
      return true;
    } catch (error) {
      return false;
    }
  }
}
