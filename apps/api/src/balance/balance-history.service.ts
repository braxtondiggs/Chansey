import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AccountValueHistoryDto, ExchangeBalanceDto, HistoricalBalanceDto } from './dto';
import { HistoricalBalance } from './historical-balance.entity';

import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class BalanceHistoryService {
  private readonly logger = new Logger(BalanceHistoryService.name);

  constructor(
    private readonly userService: UsersService,
    @InjectRepository(HistoricalBalance)
    private readonly historicalBalanceRepository: Repository<HistoricalBalance>
  ) {}

  /**
   * Get historical balances for the user from all exchanges
   * @param user The user to get balances for
   * @param periods The time periods to get historical balances for
   * @returns Historical balance information
   */
  async getHistoricalBalances(user: User, periods: string[]): Promise<HistoricalBalanceDto[]> {
    const historicalBalances: HistoricalBalanceDto[] = [];

    try {
      for (const period of periods) {
        const timestamp = this.getHistoricalTimestamp(period);
        const { start, end } = this.getWindowForPeriod(period, timestamp);

        // Query only within the relevant time window instead of loading all rows
        const storedBalances = await this.historicalBalanceRepository
          .createQueryBuilder('hb')
          .leftJoinAndSelect('hb.exchange', 'exchange')
          .where('hb.userId = :userId', { userId: user.id })
          .andWhere('hb.timestamp BETWEEN :start AND :end', { start, end })
          .orderBy('hb.timestamp', 'DESC')
          .getMany();

        if (storedBalances.length > 0) {
          const exchangeGroups = this.groupByExchange(storedBalances);

          for (const balances of Object.values(exchangeGroups)) {
            // Sort by timestamp difference to find the closest match
            balances.sort(
              (a, b) =>
                Math.abs(a.timestamp.getTime() - timestamp.getTime()) -
                Math.abs(b.timestamp.getTime() - timestamp.getTime())
            );

            const closest = balances[0];

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
          this.logger.warn(`No historical data found for user ${user.id} for period ${period}`);
        }
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error retrieving historical balances: ${err.message}`, err.stack);
      return [];
    }

    return historicalBalances;
  }

  /**
   * Get account value history for a user across all exchanges
   * @param user The user to get account value history for
   * @param days Number of days to look back
   * @returns Account value history information
   */
  async getAccountValueHistory(
    user: User,
    days = 30,
    currentBalances?: ExchangeBalanceDto[]
  ): Promise<AccountValueHistoryDto> {
    try {
      // Calculate the date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      this.logger.log(
        `Getting account value history for user: ${user.id}, from ${startDate.toISOString()} to ${endDate.toISOString()}`
      );

      // Use a direct query to get data with proper exchange information
      const historicalBalances = await this.historicalBalanceRepository
        .createQueryBuilder('hb')
        .where('hb.userId = :userId', { userId: user.id })
        .andWhere('hb.timestamp >= :startDate', { startDate })
        .andWhere('hb.timestamp <= :endDate', { endDate })
        .orderBy('hb.timestamp', 'ASC')
        .getMany();

      this.logger.debug(`Found ${historicalBalances.length} historical balance records for user ${user.id}`);

      if (historicalBalances.length === 0) {
        return {
          history: [],
          currentValue: 0,
          changePercentage: 0,
          changeAmount: 0
        };
      }

      // Determine the appropriate grouping interval based on the requested time period
      const groupingInterval = this.getGroupingIntervalForDays(days);
      this.logger.debug(`Using ${groupingInterval} grouping interval for ${days} days period`);

      // Group balances by the appropriate interval using exchange-aware grouping
      const groupedBalancesByExchange: Record<string, Record<string, HistoricalBalance>> = {};

      for (const balance of historicalBalances) {
        // Format date according to the chosen grouping interval
        const timestamp = balance.timestamp;
        const groupKey = this.formatDateByInterval(timestamp, groupingInterval);

        // Initialize objects if they don't exist
        if (!groupedBalancesByExchange[groupKey]) {
          groupedBalancesByExchange[groupKey] = {};
        }

        // For each exchange in each time group, keep the latest balance
        if (
          !groupedBalancesByExchange[groupKey][balance.exchangeId] ||
          groupedBalancesByExchange[groupKey][balance.exchangeId].timestamp < balance.timestamp
        ) {
          groupedBalancesByExchange[groupKey][balance.exchangeId] = balance;
        }
      }

      // For each interval, calculate the total value across all exchanges
      const history = Object.entries(groupedBalancesByExchange).map(([datetime, exchangeBalances]) => {
        // Calculate total value across all exchanges for this interval
        const intervalValue = Object.values(exchangeBalances).reduce((sum, balance) => sum + balance.totalUsdValue, 0);

        return {
          datetime,
          value: Math.round(intervalValue * 100) / 100 // Round to 2 decimal places
        };
      });

      // Get the current total account value from provided balances or fall back to latest historical value
      let currentValue = 0;
      if (currentBalances && currentBalances.length > 0) {
        currentValue = currentBalances.reduce((sum, exchange) => sum + exchange.totalUsdValue, 0);
      } else if (history.length > 0) {
        currentValue = history[history.length - 1].value;
      }

      // Calculate change percentage and dollar amount
      let changePercentage = 0;
      let changeAmount = 0;
      if (history.length > 0) {
        const oldestValue = history[0].value;
        changeAmount = Math.round((currentValue - oldestValue) * 100) / 100;
        if (oldestValue > 0) {
          changePercentage = ((currentValue - oldestValue) / oldestValue) * 100;
          // Round to 2 decimal places
          changePercentage = Math.round(changePercentage * 100) / 100;
        }
      }

      // Sort the history data points by datetime to ensure chronological order
      history.sort((a, b) => a.datetime.localeCompare(b.datetime));

      // Apply data smoothing if needed for larger time ranges
      const sampledHistory = this.sampleHistoryPoints(history, days);

      return {
        history: sampledHistory,
        currentValue: Math.round(currentValue * 100) / 100, // Round to 2 decimal places
        changePercentage,
        changeAmount
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error getting account value history for user: ${user.id}`, err.stack);
      throw error;
    }
  }

  async storeHistoricalBalances(fetchBalances: (user: User) => Promise<ExchangeBalanceDto[]>) {
    this.logger.log('Starting manual historical balance storage');

    try {
      // Get all users with active exchange keys
      const users = await this.userService.getUsersWithActiveExchangeKeys();
      this.logger.log(`Found ${users.length} users with active exchange keys`);

      // Process users in parallel chunks to limit concurrent exchange API calls
      const CHUNK_SIZE = 5;
      for (let i = 0; i < users.length; i += CHUNK_SIZE) {
        const chunk = users.slice(i, i + CHUNK_SIZE);
        const results = await Promise.allSettled(chunk.map((user) => this.storeUserBalances(user, fetchBalances)));
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'rejected') {
            const err = toErrorInfo(result.reason);
            this.logger.error(`Error storing historical balances for user ${chunk[j].id}: ${err.message}`, err.stack);
          }
        }
      }

      this.logger.log('Finished storing historical balances');
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error('Error in historical balance storage task', err.stack);
    }
  }

  /**
   * Store current balances for a user
   * @param user The user to store balances for
   * @param fetchBalances Callback to fetch current balances from exchanges
   */
  async storeUserBalances(user: User, fetchBalances: (user: User) => Promise<ExchangeBalanceDto[]>) {
    try {
      const exchangeBalances = await fetchBalances(user);

      if (!exchangeBalances?.length) {
        return;
      }

      for (const exchangeBalance of exchangeBalances) {
        if (exchangeBalance.balances.length === 0) {
          this.logger.warn(`Skipping storage for exchange ${exchangeBalance.name} - no balance data`);
          continue;
        }

        const historicalBalance = new HistoricalBalance();
        historicalBalance.userId = user.id;
        historicalBalance.exchangeId = exchangeBalance.id;
        historicalBalance.balances = exchangeBalance.balances.map((b) => ({
          asset: b.asset,
          free: b.free,
          locked: b.locked,
          usdValue: b.usdValue ?? 0
        }));
        historicalBalance.totalUsdValue = exchangeBalance.totalUsdValue;
        historicalBalance.timestamp = new Date();

        await this.historicalBalanceRepository.save(historicalBalance);
      }

      this.logger.debug(`Stored historical balances for user ${user.id}`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error storing balances for user ${user.id}: ${err.message}`, err.stack);
    }
  }

  /**
   * Get a search window around the target timestamp based on the period
   */
  private getWindowForPeriod(period: string, target: Date): { start: Date; end: Date } {
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    let marginMs: number;

    switch (period) {
      case '24h':
        marginMs = 1 * MS_PER_DAY;
        break;
      case '7d':
        marginMs = 2 * MS_PER_DAY;
        break;
      case '30d':
        marginMs = 5 * MS_PER_DAY;
        break;
      default:
        marginMs = 1 * MS_PER_DAY;
        break;
    }

    return {
      start: new Date(target.getTime() - marginMs),
      end: new Date(target.getTime() + marginMs)
    };
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
   * Get the appropriate grouping interval based on the requested time period
   */
  private getGroupingIntervalForDays(days: number): 'hourly' | 'daily' | 'weekly' | 'monthly' {
    if (days <= 2) return 'hourly';
    if (days <= 14) return 'daily';
    if (days <= 90) return 'weekly';
    return 'monthly';
  }

  /**
   * Format a date according to the specified interval
   */
  private formatDateByInterval(date: Date, interval: 'hourly' | 'daily' | 'weekly' | 'monthly'): string {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const hour = date.getUTCHours();

    switch (interval) {
      case 'hourly': {
        return new Date(Date.UTC(year, month, day, hour)).toISOString();
      }

      case 'daily': {
        return new Date(Date.UTC(year, month, day)).toISOString();
      }

      case 'weekly': {
        const dayOfWeek = date.getUTCDay();
        const diff = dayOfWeek === 0 ? 0 : dayOfWeek;
        const sunday = new Date(Date.UTC(year, month, day - diff));
        return sunday.toISOString();
      }

      case 'monthly': {
        return new Date(Date.UTC(year, month, 1)).toISOString();
      }

      default: {
        return new Date(Date.UTC(year, month, day, hour)).toISOString();
      }
    }
  }

  /**
   * Sample history points based on the time period to avoid returning too many data points
   */
  private sampleHistoryPoints(
    history: { datetime: string; value: number }[],
    days: number
  ): { datetime: string; value: number }[] {
    if (history.length <= 1) return history;

    // For short periods, return full data
    if (days <= 7) return history;

    // Determine the target number of data points based on days
    let targetPoints = 0;
    if (days <= 30) targetPoints = 60;
    else if (days <= 90) targetPoints = 90;
    else if (days <= 365) targetPoints = 52;
    else targetPoints = 48;

    // If we have fewer points than target, return all points
    if (history.length <= targetPoints) return history;

    const result: { datetime: string; value: number }[] = [];
    const first = history[0];
    const last = history[history.length - 1];

    if (targetPoints >= 3) {
      result.push(first);

      const interval = Math.ceil(history.length / (targetPoints - 2));

      for (let i = interval; i < history.length - interval; i += interval) {
        result.push(history[i]);
      }

      result.push(last);
    } else {
      result.push(first);
      result.push(last);
    }

    return result;
  }

  /**
   * Get a timestamp for a historical period
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
}
