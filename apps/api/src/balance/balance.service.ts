import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AssetBalanceDto, ExchangeBalanceDto, HistoricalBalanceDto, BalanceResponseDto } from './dto';

import { BinanceService } from '../exchange/binance/binance.service';
import { CoinbaseService } from '../exchange/coinbase/coinbase.service';
import { ExchangeKeyService } from '../exchange/exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange/exchange.service';
import { User } from '../users/users.entity';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly binanceService: BinanceService,
    private readonly coinbaseService: CoinbaseService,
    private readonly exchangeService: ExchangeService,
    private readonly exchangeKeyService: ExchangeKeyService
  ) {}

  /**
   * Get balances from all exchanges for a user
   * @param user The user to get balances for
   * @param includeHistorical Whether to include historical balances
   * @param period The time periods to include for historical balances
   * @returns Balance information from all connected exchanges
   */
  async getUserBalances(user: User, includeHistorical = false, periods: string[] = []): Promise<BalanceResponseDto> {
    this.logger.log(`Getting balances for user: ${user.id}, historical: ${includeHistorical}`);

    try {
      // Get current balances from all exchanges
      const currentBalances = await this.getCurrentBalances(user);

      // Calculate total USD value across all exchanges
      const totalUsdValue = currentBalances.reduce((sum, exchange) => sum + exchange.totalUsdValue, 0);

      // Create the response
      const response: BalanceResponseDto = {
        current: currentBalances,
        totalUsdValue
      };

      // Get historical balances if requested
      if (includeHistorical && periods.length > 0) {
        response.historical = await this.getHistoricalBalances(user, periods);
      }

      return response;
    } catch (error) {
      this.logger.error(`Error getting balances for user: ${user.id}`, error.stack);
      throw error;
    }
  }

  /**
   * Get current balances from all connected exchanges
   * @param user The user to get balances for
   * @returns Balance information from all connected exchanges
   */
  private async getCurrentBalances(user: User): Promise<ExchangeBalanceDto[]> {
    // Find all exchanges for which the user has active API keys
    // We need to load exchanges eagerly with the user to make key retrieval more efficient
    const exchanges = await this.exchangeService.findAllWithUserKeys(user.id);
    const exchangeBalances: ExchangeBalanceDto[] = [];

    // Get balances from each exchange
    for (const exchange of exchanges) {
      try {
        let balances: AssetBalanceDto[] = [];
        let totalUsdValue = 0;

        switch (exchange.slug) {
          case 'binance_us':
            balances = await this.getBinanceBalances(user);
            break;
          case 'coinbase':
            balances = await this.getCoinbaseBalances(user);
            break;
          // Add cases for other exchanges as they're added
          default:
            this.logger.warn(`No handler for exchange: ${exchange.slug}`);
            continue;
        }

        // Calculate USD value for each asset and the total
        balances = await this.calculateUsdValues(balances, exchange.slug, user);
        totalUsdValue = balances.reduce((sum, asset) => sum + (asset.usdValue || 0), 0);

        exchangeBalances.push({
          exchange: exchange.slug,
          exchangeName: exchange.name,
          balances,
          totalUsdValue,
          timestamp: new Date()
        });
      } catch (error) {
        this.logger.error(`Error getting balances from ${exchange.name}`, error.stack);
        // Continue with other exchanges instead of failing completely
      }
    }

    return exchangeBalances;
  }

  /**
   * Get historical balances for the user from all exchanges
   * @param user The user to get balances for
   * @param periods The time periods to get historical balances for
   * @returns Historical balance information
   */
  private async getHistoricalBalances(user: User, periods: string[]): Promise<HistoricalBalanceDto[]> {
    // This would typically fetch from a database of stored historical balances
    // Since we don't have actual historical data in this implementation, we'll simulate it

    const currentBalances = await this.getCurrentBalances(user);
    const historicalBalances: HistoricalBalanceDto[] = [];

    for (const period of periods) {
      // In a real implementation, you would fetch historical data from a database
      // Here we're just modifying current data to simulate historical values
      for (const exchangeBalance of currentBalances) {
        // Create a deep copy of the exchange balance
        const historicalBalance: HistoricalBalanceDto = {
          ...exchangeBalance,
          balances: JSON.parse(JSON.stringify(exchangeBalance.balances)),
          period,
          // Set the timestamp to be in the past based on the period
          timestamp: this.getHistoricalTimestamp(period)
        };

        // Apply a random adjustment factor to simulate different historical values
        const adjustmentFactor = this.getAdjustmentFactor(period);
        historicalBalance.balances.forEach((balance) => {
          const freeBigNumber = parseFloat(balance.free);
          const lockedBigNumber = parseFloat(balance.locked);

          balance.free = (freeBigNumber * adjustmentFactor).toString();
          balance.locked = (lockedBigNumber * adjustmentFactor).toString();

          if (balance.usdValue) {
            balance.usdValue *= adjustmentFactor;
          }
        });

        historicalBalance.totalUsdValue *= adjustmentFactor;

        historicalBalances.push(historicalBalance);
      }
    }

    return historicalBalances;
  }

  /**
   * Get Binance balances for a user
   * @param user The user to get balances for
   * @returns Balances for all assets in the user's Binance account
   */
  private async getBinanceBalances(user: User): Promise<AssetBalanceDto[]> {
    try {
      const binanceBalances = await this.binanceService.getBalance(user);
      return binanceBalances;
    } catch (error) {
      this.logger.error(`Error getting Binance balances: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get Coinbase balances for a user
   * @param user The user to get balances for
   * @returns Balances for all assets in the user's Coinbase account
   */
  private async getCoinbaseBalances(user: User): Promise<AssetBalanceDto[]> {
    try {
      // This method would need to be implemented in the CoinbaseService
      // For now, we'll return an empty array
      const accounts = await this.coinbaseService.getAccounts();

      // Transform Coinbase accounts to AssetBalanceDto format
      return accounts.data.accounts.map((account) => ({
        asset: account.currency.code,
        free: account.balance.amount,
        locked: '0' // Coinbase doesn't have a "locked" concept the same way
      }));
    } catch (error) {
      // If the method doesn't exist or fails, return an empty array
      this.logger.error(`Error getting Coinbase balances: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Calculate USD values for each asset
   * @param balances The balances to calculate USD values for
   * @param exchangeSlug The exchange slug
   * @param user The user
   * @returns Balances with USD values added
   */
  private async calculateUsdValues(
    balances: AssetBalanceDto[],
    exchangeSlug: string,
    user: User
  ): Promise<AssetBalanceDto[]> {
    for (const balance of balances) {
      try {
        if (balance.asset === 'USDT' || balance.asset === 'USD') {
          // Stablecoins are already in USD
          balance.usdValue = parseFloat(balance.free) + parseFloat(balance.locked);
        } else {
          // For other assets, fetch the current price
          const symbol = `${balance.asset}USDT`;
          let price = 0;

          if (exchangeSlug === 'binance_us') {
            price = await this.binanceService.getPriceBySymbol(symbol, user);
          } else if (exchangeSlug === 'coinbase') {
            // This would need to be implemented in the CoinbaseService
            // For now, we'll use a placeholder
            const response = await this.coinbaseService.getPrice(`${balance.asset}-USD`);
            price = parseFloat(response.data.amount);
          }

          // Calculate USD value
          const totalAmount = parseFloat(balance.free) + parseFloat(balance.locked);
          balance.usdValue = totalAmount * price;
        }
      } catch (error) {
        this.logger.warn(`Unable to calculate USD value for ${balance.asset}: ${error.message}`);
        balance.usdValue = 0;
      }
    }

    return balances;
  }

  /**
   * Get a timestamp for a historical period
   * @param period The period to get a timestamp for
   * @returns A date object representing the start of the period
   */
  private getHistoricalTimestamp(period: string): Date {
    const now = new Date();

    switch (period) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      default:
        return now;
    }
  }

  /**
   * Get a random adjustment factor for historical balances
   * @param period The period to get an adjustment factor for
   * @returns A number between 0.5 and 1.5 to adjust balances by
   */
  private getAdjustmentFactor(period: string): number {
    // In a real implementation, you'd have actual historical data
    // This is just to simulate different values for demo purposes
    switch (period) {
      case '24h':
        // 24h values are relatively close to current values
        return 0.9 + Math.random() * 0.2; // 0.9 to 1.1
      case '7d':
        // 7d values can be more different
        return 0.8 + Math.random() * 0.4; // 0.8 to 1.2
      case '30d':
        // 30d values can be significantly different
        return 0.7 + Math.random() * 0.6; // 0.7 to 1.3
      default:
        return 1;
    }
  }
}
