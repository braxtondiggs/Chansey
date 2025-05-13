import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UsersService } from './../users/users.service';
import {
  AssetBalanceDto,
  ExchangeBalanceDto,
  HistoricalBalanceDto,
  BalanceResponseDto,
  AccountValueHistoryDto
} from './dto';
import { HistoricalBalance } from './historical-balance.entity';

import { BinanceUSService } from '../exchange/binance/binance-us.service';
import { CoinbaseService } from '../exchange/coinbase/coinbase.service';
import { Exchange } from '../exchange/exchange.entity';
import { User } from '../users/users.entity';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    private readonly binanceService: BinanceUSService,
    private readonly coinbaseService: CoinbaseService,
    private readonly userService: UsersService,
    @InjectRepository(HistoricalBalance)
    private readonly historicalBalanceRepository: Repository<HistoricalBalance>
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
    const exchangeBalances: ExchangeBalanceDto[] = [];
    // Get balances from each exchange
    for (const exchange of user.exchanges) {
      try {
        let balances: AssetBalanceDto[] = [];
        let totalUsdValue = 0;

        switch (exchange.slug) {
          case 'binance_us':
            balances = await this.getBinanceBalances(user);
            break;
          case 'gdax':
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
          id: exchange.id,
          slug: exchange.slug,
          name: exchange.name,
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
    const historicalBalances: HistoricalBalanceDto[] = [];

    try {
      for (const period of periods) {
        // Get the timestamp for the requested period
        const timestamp = this.getHistoricalTimestamp(period);

        // Query the database for historical balances closest to the timestamp
        const storedBalances = await this.historicalBalanceRepository.find({
          where: { userId: user.id },
          // Find records closest to the target timestamp
          order: { timestamp: 'DESC' }
          // We can use a custom query to get the closest match to our target timestamp
          // But for simplicity, we'll just get records after this timestamp for now
        });

        // If we have stored historical data
        if (storedBalances.length > 0) {
          // Group by exchange
          const exchangeGroups = this.groupByExchange(storedBalances);

          // For each exchange, find the closest record to our target timestamp
          for (const [, balances] of Object.entries(exchangeGroups)) {
            // Sort by timestamp difference to find the closest match
            balances.sort(
              (a, b) =>
                Math.abs(a.timestamp.getTime() - timestamp.getTime()) -
                Math.abs(b.timestamp.getTime() - timestamp.getTime())
            );

            // Use the closest match
            const closest = balances[0];

            // Convert to DTO format
            const historicalDto: HistoricalBalanceDto = {
              id: closest.id,
              slug: closest.exchange.slug,
              name: closest.exchange.name,
              balances: closest.balances.map((b) => ({
                asset: b.asset,
                free: b.free,
                locked: b.locked,
                usdValue: b.usdValue
              })),
              totalUsdValue: closest.totalUsdValue,
              timestamp: closest.timestamp,
              period
            };

            historicalBalances.push(historicalDto);
          }
        } else {
          // Fallback to simulated data if we don't have real historical data
          this.logger.warn(`No historical data found for user ${user.id} for period ${period}. Using simulated data.`);

          const currentBalances = await this.getCurrentBalances(user);
          for (const exchangeBalance of currentBalances) {
            // Create a simulated historical balance
            const historicalBalance: HistoricalBalanceDto = {
              ...exchangeBalance,
              balances: JSON.parse(JSON.stringify(exchangeBalance.balances)),
              period,
              timestamp
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
      }
    } catch (error) {
      this.logger.error(`Error retrieving historical balances: ${error.message}`, error.stack);
      // Return an empty array if we can't get historical data
      return [];
    }

    return historicalBalances;
  }

  /**
   * Group historical balances by exchange
   */
  private groupByExchange(balances: HistoricalBalance[]): Record<string, HistoricalBalance[]> {
    const groups: Record<string, HistoricalBalance[]> = {};

    for (const balance of balances) {
      if (!groups[balance.exchangeId]) {
        groups[balance.exchangeId] = [];
      }
      groups[balance.exchangeId].push(balance);
    }

    return groups;
  }

  /**
   * Get Binance balances for a user
   * @param user The user to get balances for
   * @returns Balances for all assets in the user's Binance account
   */
  private async getBinanceBalances(user: User): Promise<AssetBalanceDto[]> {
    try {
      return await this.binanceService.getBalance(user);
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
      // Use getBalance method directly to match how Binance is handled
      return await this.coinbaseService.getBalance(user);
    } catch (error) {
      // If the method fails, return an empty array
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
          const symbol = `${balance.asset}/USDT`;
          let price = 0;

          if (exchangeSlug === 'binance_us') {
            price = await this.binanceService.getPriceBySymbol(symbol, user);
          } else if (exchangeSlug === 'gdax') {
            // Coinbase uses 'gdax' as the slug internally
            const response = await this.coinbaseService.getPrice(`${balance.asset}/USD`);
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

  /**
   * Store all user balances every hour for historical tracking
   * This runs automatically as a scheduled task
   */
  @Cron(CronExpression.EVERY_HOUR)
  async storeHistoricalBalances() {
    this.logger.log('Starting scheduled historical balance storage');

    try {
      // Get all users with active exchange keys
      const users = await this.getUsersWithActiveExchangeKeys();
      this.logger.log(`Found ${users.length} users with active exchange keys`);

      // Store balances for each user
      for (const user of users) {
        try {
          await this.storeUserBalances(user);
        } catch (error) {
          this.logger.error(`Error storing historical balances for user ${user.id}: ${error.message}`, error.stack);
          // Continue with other users instead of failing completely
        }
      }

      this.logger.log('Finished storing historical balances');
    } catch (error) {
      this.logger.error('Error in historical balance storage task', error.stack);
    }
  }

  /**
   * Store current balances for a user
   * @param user The user to store balances for
   */
  async storeUserBalances(user: User) {
    try {
      // Get current balances for the user
      const exchangeBalances = await this.getCurrentBalances(user);

      // Store each exchange's balances separately
      for (const exchangeBalance of exchangeBalances) {
        const historicalBalance = new HistoricalBalance();
        historicalBalance.user = user;
        historicalBalance.userId = user.id;
        historicalBalance.exchange = { id: exchangeBalance.id } as Exchange;
        historicalBalance.exchangeId = exchangeBalance.id;
        historicalBalance.balances = exchangeBalance.balances.map((b) => ({
          asset: b.asset,
          free: b.free,
          locked: b.locked,
          usdValue: b.usdValue || 0 // Ensure usdValue is always provided
        }));
        historicalBalance.totalUsdValue = exchangeBalance.totalUsdValue;
        historicalBalance.timestamp = new Date();

        await this.historicalBalanceRepository.save(historicalBalance);
      }

      this.logger.debug(`Stored historical balances for user ${user.id}`);
    } catch (error) {
      this.logger.error(`Error storing balances for user ${user.id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get all users who have active exchange keys
   * This is a temporary implementation - in a real application,
   * you would fetch this from your user service
   */
  private async getUsersWithActiveExchangeKeys(): Promise<User[]> {
    // This is a placeholder - you'll need to implement this to fetch
    // actual users who have active exchange keys
    // For example, you might query the database directly or use a user service

    // For testing purposes, we'll return a test user if one is available
    const userIds = await this.historicalBalanceRepository.manager
      .createQueryBuilder()
      .select('DISTINCT "userId"')
      .from('exchange_key', 'ek')
      .where('ek."isActive" = :isActive', { isActive: true })
      .getRawMany();

    if (userIds.length === 0) {
      this.logger.warn('No users found with active exchange keys');
      return [];
    }

    // Fetch full user details for each userId
    const users: User[] = [];
    for (const userRow of userIds) {
      try {
        const user = await this.userService.getById(userRow.userId, true);
        user.exchanges = user.exchanges.map((exchange) => ({ ...exchange, id: exchange.exchangeId })) as any[]; //!NOTE: This is a terrible hack to trick the typeorm
        users.push(user);
      } catch (error) {
        this.logger.warn(`Failed to get user details for ID ${userRow.userId}: ${error.message}`);
      }
    }

    return users;
  }

  /**
   * Get account value history for a user across all exchanges
   * @param user The user to get account value history for
   * @param days Number of days to look back
   * @returns Account value history information
   */
  async getAccountValueHistory(user: User, days = 30): Promise<AccountValueHistoryDto> {
    try {
      // Calculate the date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      this.logger.log(
        `Getting account value history for user: ${user.id}, from ${startDate.toISOString()} to ${endDate.toISOString()}`
      );

      // Query historical balances within the date range
      const historicalBalances = await this.historicalBalanceRepository
        .createQueryBuilder('hb')
        .where('hb.userId = :userId', { userId: user.id })
        .andWhere('hb.timestamp >= :startDate', { startDate })
        .andWhere('hb.timestamp <= :endDate', { endDate })
        .orderBy('hb.timestamp', 'ASC')
        .getMany();

      // Group balances by hour
      const hourlyBalances: Record<string, HistoricalBalance[]> = {};

      for (const balance of historicalBalances) {
        // Format date and hour as YYYY-MM-DDTHH:00:00Z for hourly grouping
        const timestamp = balance.timestamp;
        const hourlyKey = new Date(
          Date.UTC(timestamp.getUTCFullYear(), timestamp.getUTCMonth(), timestamp.getUTCDate(), timestamp.getUTCHours())
        ).toISOString();

        if (!hourlyBalances[hourlyKey]) {
          hourlyBalances[hourlyKey] = [];
        }

        hourlyBalances[hourlyKey].push(balance);
      }

      // For each hour, calculate the total value across all exchanges
      const history = Object.entries(hourlyBalances).map(([datetime, balances]) => {
        // Calculate total value across all exchanges for this hour
        const hourlyValue = balances.reduce((sum, balance) => sum + balance.totalUsdValue, 0);

        return {
          datetime,
          value: hourlyValue
        };
      });

      // Get the current total account value by fetching current balances or using the latest historical value
      let currentValue = 0;
      try {
        // Get current balances from all exchanges
        const currentBalances = await this.getCurrentBalances(user);
        currentValue = currentBalances.reduce((sum, exchange) => sum + exchange.totalUsdValue, 0);
      } catch (error) {
        // If we can't get current balances, use the latest historical value
        this.logger.warn(`Couldn't get current balances, using latest historical value`);
        if (history.length > 0) {
          currentValue = history[history.length - 1].value;
        }
      }

      // Calculate change percentage
      let changePercentage = 0;
      if (history.length > 0) {
        const oldestValue = history[0].value;
        if (oldestValue > 0) {
          changePercentage = ((currentValue - oldestValue) / oldestValue) * 100;
          // Round to 2 decimal places
          changePercentage = Math.round(changePercentage * 100) / 100;
        }
      }

      // Sort the history data points by datetime to ensure chronological order
      history.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

      return {
        history,
        currentValue: Math.round(currentValue * 100) / 100, // Round to 2 decimal places
        changePercentage
      };
    } catch (error) {
      this.logger.error(`Error getting account value history for user: ${user.id}`, error.stack);
      throw error;
    }
  }
}
