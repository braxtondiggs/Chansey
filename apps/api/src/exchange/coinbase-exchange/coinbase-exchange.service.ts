import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { AssetBalanceDto } from '../../balance/dto/balance-response.dto';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class CoinbaseExchangeService extends BaseExchangeService {
  protected readonly exchangeSlug = 'gdax'; // Coinbase Pro's slug
  protected readonly exchangeId: keyof typeof ccxt = 'coinbaseexchange';
  protected readonly apiKeyConfigName = 'COINBASE_EXCHANGE_API_KEY';
  protected readonly apiSecretConfigName = 'COINBASE_EXCHANGE_API_SECRET';

  constructor(
    configService?: ConfigService,
    @Inject(forwardRef(() => ExchangeService)) exchangeService?: ExchangeService,
    @Inject(forwardRef(() => ExchangeKeyService)) exchangeKeyService?: ExchangeKeyService
  ) {
    super(configService, exchangeKeyService, exchangeService);
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

      const client = await this.getClient();
      const ticker = await client.fetchTicker(formattedSymbol);

      // Return in the format expected by existing code
      return {
        symbol: symbol,
        price: ticker.last?.toString() || '0',
        timestamp: Number(ticker.timestamp ?? 0)
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching Coinbase Pro price for ${symbol}`, err.stack || err.message);
      throw new Error(`Failed to fetch Coinbase Pro price for ${symbol}`);
    }
  }

  /**
   * Override getAdditionalClientConfig for Coinbase Pro specific configuration
   */
  protected getAdditionalClientConfig(): object {
    return {
      v3: true // Use v3 API for Coinbase Pro
    };
  }

  async getBalance(user: User): Promise<AssetBalanceDto[]> {
    try {
      const client = await this.getClient(user);
      const balances = await client.fetchBalance();

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
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching Coinbase Pro balance for user ${user.id}`, err.stack || err.message);
      return [];
    }
  }
}
