import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UsersService } from './../users/users.service';
import {
  AccountValueHistoryDto,
  AssetBalanceDto,
  AssetDetailsDto,
  BalanceResponseDto,
  ExchangeBalanceDto,
  HistoricalBalanceDto
} from './dto';
import { HistoricalBalance } from './historical-balance.entity';

import { CoinService } from '../coin/coin.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

const EXCHANGE_TIMEOUT_MS = 15_000;

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly coinService: CoinService,
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
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error getting balances for user: ${user.id}`, err.stack);
      throw error;
    }
  }

  /**
   * Get current balances from all connected exchanges in parallel
   */
  private async getCurrentBalances(user: User): Promise<ExchangeBalanceDto[]> {
    const activeExchanges = user.exchanges.filter((e) => e.isActive);

    const results = await Promise.allSettled(
      activeExchanges.map((exchange) => this.fetchExchangeBalance(exchange, user))
    );

    return results.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      const err = toErrorInfo(result.reason);
      this.logger.error(`Error getting balances from ${activeExchanges[i].name}: ${err.message}`, err.stack);
      return this.buildExchangeBalanceDto(activeExchanges[i]);
    });
  }

  /**
   * Fetch balance for a single exchange with timeout protection
   */
  private async fetchExchangeBalance(
    exchange: { exchangeId: string; slug: string; name: string },
    user: User
  ): Promise<ExchangeBalanceDto> {
    let exchangeService;
    try {
      exchangeService = this.exchangeManagerService.getExchangeService(exchange.slug);
    } catch (serviceError: unknown) {
      const svcErr = toErrorInfo(serviceError);
      this.logger.warn(`No handler for exchange: ${exchange.slug} - ${svcErr.message}`);
      return this.buildExchangeBalanceDto(exchange);
    }

    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Timeout getting balances from ${exchange.name} after ${EXCHANGE_TIMEOUT_MS}ms`)),
        EXCHANGE_TIMEOUT_MS
      );
    });

    let balances: AssetBalanceDto[];
    try {
      balances = await Promise.race([exchangeService.getBalance(user), timeoutPromise]);
    } catch (timeoutError: unknown) {
      const tmErr = toErrorInfo(timeoutError);
      this.logger.error(`Timeout or error getting balances from ${exchange.name}: ${tmErr.message}`);
      return this.buildExchangeBalanceDto(exchange);
    } finally {
      clearTimeout(timeoutId);
    }

    if (balances.length === 0) {
      this.logger.warn(`No balances retrieved for exchange ${exchange.name}`);
      return this.buildExchangeBalanceDto(exchange);
    }

    let pricedBalances = balances;
    let totalUsdValue = 0;
    try {
      pricedBalances = await this.calculateUsdValues(balances, exchange.slug);
      totalUsdValue = pricedBalances.reduce((sum, asset) => sum + (asset.usdValue ?? 0), 0);
    } catch (calcError: unknown) {
      const calcErr = toErrorInfo(calcError);
      this.logger.error(`Error calculating USD values for ${exchange.name}: ${calcErr.message}`);
    }

    return this.buildExchangeBalanceDto(exchange, pricedBalances, totalUsdValue);
  }

  /**
   * Build a standardized ExchangeBalanceDto
   */
  private buildExchangeBalanceDto(
    exchange: { exchangeId: string; slug: string; name: string },
    balances: AssetBalanceDto[] = [],
    totalUsdValue = 0
  ): ExchangeBalanceDto {
    return {
      id: exchange.exchangeId,
      slug: exchange.slug,
      name: exchange.name,
      balances,
      totalUsdValue,
      timestamp: new Date()
    };
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
          for (const balances of Object.values(exchangeGroups)) {
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
          this.logger.warn(`No historical data found for user ${user.id} for period ${period}`);
        }
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error retrieving historical balances: ${err.message}`, err.stack);
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
   * Calculate USD values for each asset in parallel (returns new array, does not mutate input)
   */
  private async calculateUsdValues(balances: AssetBalanceDto[], exchangeSlug: string): Promise<AssetBalanceDto[]> {
    const quoteAsset = exchangeSlug === 'binance_us' ? 'USDT' : 'USD';

    return Promise.all(
      balances.map(async (balance): Promise<AssetBalanceDto> => {
        const totalAmount = parseFloat(balance.free) + parseFloat(balance.locked);

        if (balance.asset === 'USDT' || balance.asset === 'USD') {
          return { ...balance, usdValue: totalAmount };
        }

        const symbol = `${balance.asset}/${quoteAsset}`;
        try {
          const response = await this.exchangeManagerService.getPrice(exchangeSlug, symbol);
          return { ...balance, usdValue: totalAmount * parseFloat(response.price) };
        } catch (priceError: unknown) {
          const prcErr = toErrorInfo(priceError);
          this.logger.warn(`Unable to get price for ${symbol} on ${exchangeSlug}: ${prcErr.message}`);
          return { ...balance, usdValue: 0 };
        }
      })
    );
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
   * Get the appropriate grouping interval based on the requested time period
   * @param days Number of days to look back
   * @returns The appropriate grouping interval (hourly, daily, weekly, or monthly)
   */
  private getGroupingIntervalForDays(days: number): 'hourly' | 'daily' | 'weekly' | 'monthly' {
    if (days <= 2) return 'hourly'; // For 1-2 days: hourly data points
    if (days <= 14) return 'daily'; // For 3-14 days: daily data points
    if (days <= 90) return 'weekly'; // For 15-90 days: weekly data points
    return 'monthly'; // For 91+ days: monthly data points
  }

  /**
   * Format a date according to the specified interval
   * @param date The date to format
   * @param interval The interval to format for (hourly, daily, weekly, or monthly)
   * @returns A formatted date string
   */
  private formatDateByInterval(date: Date, interval: 'hourly' | 'daily' | 'weekly' | 'monthly'): string {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    const hour = date.getUTCHours();

    switch (interval) {
      case 'hourly': {
        // Format as YYYY-MM-DDTHH:00:00Z for hourly grouping
        return new Date(Date.UTC(year, month, day, hour)).toISOString();
      }

      case 'daily': {
        // Format as YYYY-MM-DDT00:00:00Z for daily grouping
        return new Date(Date.UTC(year, month, day)).toISOString();
      }

      case 'weekly': {
        // Get the date of the Sunday of the week
        const dayOfWeek = date.getUTCDay();
        const diff = dayOfWeek === 0 ? 0 : dayOfWeek;
        const sunday = new Date(Date.UTC(year, month, day - diff));
        return sunday.toISOString();
      }

      case 'monthly': {
        // Format as YYYY-MM-01T00:00:00Z for monthly grouping
        return new Date(Date.UTC(year, month, 1)).toISOString();
      }

      default: {
        return new Date(Date.UTC(year, month, day, hour)).toISOString();
      }
    }
  }

  async storeHistoricalBalances() {
    this.logger.log('Starting manual historical balance storage');

    try {
      // Get all users with active exchange keys
      const users = await this.getUsersWithActiveExchangeKeys();
      this.logger.log(`Found ${users.length} users with active exchange keys`);

      // Store balances for each user
      for (const user of users) {
        try {
          await this.storeUserBalances(user);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Error storing historical balances for user ${user.id}: ${err.message}`, err.stack);
          // Continue with other users instead of failing completely
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
   */
  async storeUserBalances(user: User) {
    const maxRetries = 3;
    const retryDelay = 5000;

    try {
      let exchangeBalances: ExchangeBalanceDto[] = [];

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          exchangeBalances = await this.getCurrentBalances(user);
          if (exchangeBalances.length > 0) break;
          this.logger.warn(`Empty balances for user ${user.id}, attempt ${attempt}/${maxRetries}`);
        } catch (balanceError: unknown) {
          if (attempt === maxRetries) throw balanceError;
          const balErr = toErrorInfo(balanceError);
          this.logger.warn(
            `Balance fetch failed for user ${user.id}, attempt ${attempt}/${maxRetries}: ${balErr.message}`
          );
        }
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }

      if (exchangeBalances.length === 0) {
        this.logger.warn(`No balances for user ${user.id} after ${maxRetries} attempts`);
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
        // Note: user.exchanges is already ExchangeKey[] with exchange relation loaded
        users.push(user);
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.warn(`Failed to get user details for ID ${userRow.userId}: ${err.message}`);
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

      // Use a direct query to get data with proper exchange information
      const historicalBalances = await this.historicalBalanceRepository
        .createQueryBuilder('hb')
        .leftJoinAndSelect('hb.exchange', 'exchange') // Join with exchange to get exchange details
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
          changePercentage: 0
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

      // Get the current total account value by fetching current balances or using the latest historical value
      let currentValue = 0;
      try {
        // Get current balances from all exchanges
        const currentBalances = await this.getCurrentBalances(user);
        currentValue = currentBalances.reduce((sum, exchange) => sum + exchange.totalUsdValue, 0);
      } catch {
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

      // Apply data smoothing if needed for larger time ranges
      const sampledHistory = this.sampleHistoryPoints(history, days);

      return {
        history: sampledHistory,
        currentValue: Math.round(currentValue * 100) / 100, // Round to 2 decimal places
        changePercentage
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error getting account value history for user: ${user.id}`, err.stack);
      throw error;
    }
  }

  /**
   * Sample history points based on the time period to avoid returning too many data points
   * @param history Full history data points
   * @param days Number of days in the requested period
   * @returns Sampled history data points
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
    if (days <= 30)
      targetPoints = 60; // 2 points per day for month view
    else if (days <= 90)
      targetPoints = 90; // 1 point per day for 3-month view
    else if (days <= 365)
      targetPoints = 52; // Weekly points for year view
    else targetPoints = 48; // Monthly points for multi-year view

    // If we have fewer points than target, return all points
    if (history.length <= targetPoints) return history;

    const result: { datetime: string; value: number }[] = [];
    // Always include first and last data point
    const first = history[0];
    const last = history[history.length - 1];

    // Use LTTB (Largest-Triangle-Three-Buckets) algorithm for important data points
    // For simplicity, we'll use a basic downsampling here, but LTTB would be better
    // for visual representation

    if (targetPoints >= 3) {
      result.push(first);

      // Calculate sampling interval
      const interval = Math.ceil(history.length / (targetPoints - 2));

      for (let i = interval; i < history.length - interval; i += interval) {
        // For simplicity, we're using direct sampling
        // In a real implementation, you'd want to use the LTTB algorithm
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
   * Get detailed asset information with current prices and values
   * @param user The user to get asset details for
   * @returns Array of asset details with prices and quantities
   */
  async getUserAssetDetails(user: User): Promise<AssetDetailsDto[]> {
    try {
      const currentBalances = await this.getCurrentBalances(user);
      const assetMap = new Map<string, AssetDetailsDto>();
      const symbols = currentBalances.flatMap((exchange) => exchange.balances.map((b) => b.asset));

      const coinDetails = await this.coinService.getMultipleCoinsBySymbol(symbols);
      const coinDetailsMap = new Map(coinDetails.map((coin) => [coin.symbol.toUpperCase(), coin]));

      for (const exchange of currentBalances) {
        for (const balance of exchange.balances) {
          const quantity = parseFloat(balance.free) + parseFloat(balance.locked);
          if (quantity <= 0) continue;

          const symbol = balance.asset;
          const usdValue = balance.usdValue ?? 0;

          const existing = assetMap.get(symbol);
          if (existing) {
            existing.quantity += quantity;
            existing.usdValue += usdValue;
            existing.price = existing.quantity > 0 ? existing.usdValue / existing.quantity : 0;
          } else {
            const coin = coinDetailsMap.get(symbol.toUpperCase());
            assetMap.set(symbol, {
              image: coin?.image,
              name: coin?.name ?? symbol,
              slug: coin?.slug ?? symbol.toLowerCase(),
              price: quantity > 0 ? usdValue / quantity : 0,
              priceChangePercentage24h: coin?.priceChangePercentage24h ?? 0,
              quantity,
              symbol,
              usdValue
            });
          }
        }
      }

      return Array.from(assetMap.values()).sort((a, b) => b.usdValue - a.usdValue);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error getting asset details for user: ${user.id}`, err.stack);
      throw error;
    }
  }
}
