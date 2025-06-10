import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { UsersService } from './../users/users.service';
import {
  AssetBalanceDto,
  ExchangeBalanceDto,
  HistoricalBalanceDto,
  BalanceResponseDto,
  AccountValueHistoryDto,
  AssetDetailsDto
} from './dto';
import { HistoricalBalance } from './historical-balance.entity';

import { CoinService } from '../coin/coin.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { Exchange } from '../exchange/exchange.entity';
import { User } from '../users/users.entity';

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
    const timeout = 15000;

    // Get balances from each exchange key
    for (const exchange of user.exchanges) {
      // Skip inactive exchange keys
      if (!exchange.isActive) {
        continue;
      }

      try {
        let balances: AssetBalanceDto[] = [];
        let totalUsdValue = 0;

        // Create a promise that will resolve with the balances or reject after timeout
        const balancePromise = new Promise<AssetBalanceDto[]>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`Timeout getting balances from ${exchange.name} after ${timeout}ms`));
          }, timeout);

          // Create a separate function to handle the async balance fetching
          const fetchBalances = async () => {
            try {
              let result: AssetBalanceDto[] = [];

              // Get the appropriate service for this exchange using ExchangeManagerService
              try {
                const exchangeService = this.exchangeManagerService.getExchangeService(exchange.slug);
                // All exchange services now have standardized getBalance method
                result = await exchangeService.getBalance(user);
              } catch (serviceError) {
                this.logger.warn(`No handler for exchange: ${exchange.slug} - ${serviceError.message}`);
                resolve([]);
                return;
              }

              clearTimeout(timer);
              resolve(result);
            } catch (err) {
              clearTimeout(timer);
              reject(err);
            }
          };

          // Start the async operation
          fetchBalances();
        });

        // Wait for the balance fetch with timeout
        try {
          balances = await balancePromise;
        } catch (timeoutError) {
          this.logger.error(`Timeout or error getting balances from ${exchange.name}: ${timeoutError.message}`);
          // Add empty balance array for this exchange so we at least have an entry
          exchangeBalances.push({
            id: exchange.exchangeId, // Use the actual exchange ID, not the exchange key ID
            slug: exchange.slug,
            name: exchange.name,
            balances: [],
            totalUsdValue: 0,
            timestamp: new Date()
          });
          continue; // Skip to next exchange
        }

        // Skip exchanges with empty balances
        if (balances.length === 0) {
          this.logger.warn(`No balances retrieved for exchange ${exchange.name}`);
          // Still add an entry with empty balances to maintain exchange record
          exchangeBalances.push({
            id: exchange.exchangeId, // Use the actual exchange ID, not the exchange key ID
            slug: exchange.slug,
            name: exchange.name,
            balances: [],
            totalUsdValue: 0,
            timestamp: new Date()
          });
          continue;
        }

        // Calculate USD value for each asset and the total with timeout protection
        try {
          balances = await this.calculateUsdValues(balances, exchange.slug);
          totalUsdValue = balances.reduce((sum, asset) => sum + (asset.usdValue || 0), 0);

          exchangeBalances.push({
            id: exchange.exchangeId, // Use the actual exchange ID, not the exchange key ID
            slug: exchange.slug,
            name: exchange.name,
            balances,
            totalUsdValue,
            timestamp: new Date()
          });
        } catch (calcError) {
          this.logger.error(`Error calculating USD values for ${exchange.name}: ${calcError.message}`);
          // Add the exchange with balances but zero USD value
          exchangeBalances.push({
            id: exchange.exchangeId, // Use the actual exchange ID, not the exchange key ID
            slug: exchange.slug,
            name: exchange.name,
            balances,
            totalUsdValue: 0,
            timestamp: new Date()
          });
        }
      } catch (error) {
        this.logger.error(`Error getting balances from ${exchange.name}: ${error.message}`, error.stack);
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
   * Calculate USD values for each asset using the ExchangeManagerService
   * @param balances The balances to calculate USD values for
   * @param exchangeSlug The exchange slug
   * @returns Balances with USD values added
   */
  private async calculateUsdValues(balances: AssetBalanceDto[], exchangeSlug: string): Promise<AssetBalanceDto[]> {
    for (const balance of balances) {
      try {
        if (balance.asset === 'USDT' || balance.asset === 'USD') {
          // Stablecoins are already in USD
          balance.usdValue = parseFloat(balance.free) + parseFloat(balance.locked);
        } else {
          // For other assets, fetch the current price using ExchangeManagerService
          let price = 0;
          let symbol = '';

          try {
            // Use appropriate symbol format for each exchange
            if (exchangeSlug === 'binance_us') {
              symbol = `${balance.asset}/USDT`;
            } else {
              // Coinbase exchanges use USD quotes
              symbol = `${balance.asset}/USD`;
            }

            const response = await this.exchangeManagerService.getPrice(exchangeSlug, symbol);
            price = parseFloat(response.price);
          } catch (priceError) {
            this.logger.warn(`Unable to get price for ${symbol} on ${exchangeSlug}: ${priceError.message}`);
            price = 0;
          }

          // Calculate USD value
          const totalAmount = parseFloat(balance.free) + parseFloat(balance.locked);
          balance.usdValue = totalAmount * price;
        }
      } catch (error) {
        this.logger.warn(`Unable to calculate USD value for ${balance.asset} on ${exchangeSlug}: ${error.message}`);
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
      // Get current balances for the user with retry mechanism
      let exchangeBalances: ExchangeBalanceDto[] = [];
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelay = 5000; // 5 seconds between retries

      while (retryCount < maxRetries) {
        try {
          exchangeBalances = await this.getCurrentBalances(user);
          // If we got balances successfully, break the retry loop
          if (exchangeBalances.length > 0) {
            break;
          }
          this.logger.warn(
            `Retrieved empty exchange balances for user ${user.id}, retrying (${retryCount + 1}/${maxRetries})...`
          );
        } catch (balanceError) {
          this.logger.warn(
            `Error getting balances on attempt ${retryCount + 1}/${maxRetries}: ${balanceError.message}`
          );
          // Only throw on the last attempt
          if (retryCount === maxRetries - 1) {
            throw balanceError;
          }
        }

        retryCount++;
        if (retryCount < maxRetries) {
          // Wait before next retry
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }

      // Only proceed with storage if we have valid balances
      if (exchangeBalances.length === 0) {
        this.logger.warn(`No exchange balances retrieved for user ${user.id} after ${maxRetries} attempts`);
        return;
      }

      // Store each exchange's balances separately
      for (const exchangeBalance of exchangeBalances) {
        // Only store balances if we have actual data
        if (exchangeBalance.balances.length === 0) {
          this.logger.warn(`Skipping storage for exchange ${exchangeBalance.name} - no balance data available`);
          continue;
        }

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
      // Don't rethrow the error to prevent the cron job from failing entirely
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

      // Apply data smoothing if needed for larger time ranges
      const sampledHistory = this.sampleHistoryPoints(history, days);

      return {
        history: sampledHistory,
        currentValue: Math.round(currentValue * 100) / 100, // Round to 2 decimal places
        changePercentage
      };
    } catch (error) {
      this.logger.error(`Error getting account value history for user: ${user.id}`, error.stack);
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
      // Get current balances from all exchanges
      const currentBalances = await this.getCurrentBalances(user);

      // Create a map to aggregate assets across exchanges
      const assetMap = new Map<string, Partial<AssetDetailsDto>>();
      const symbols = currentBalances.map((exchange) => exchange.balances.map((balance) => balance.asset)).flat();

      const coinDetails = await this.coinService.getMultipleCoinsBySymbol(symbols);
      // Create a map of coin details by symbol for easy lookup
      const coinDetailsMap = new Map(coinDetails.map((coin) => [coin.symbol.toUpperCase(), coin]));

      // Process all exchanges and their assets
      for (const exchange of currentBalances) {
        for (const balance of exchange.balances) {
          // Skip assets with zero balance
          const quantity = parseFloat(balance.free) + parseFloat(balance.locked);
          if (quantity <= 0) continue;

          const symbol = balance.asset;
          const usdValue = balance.usdValue || 0;
          const price = quantity > 0 ? usdValue / quantity : 0;
          const coin = coinDetailsMap.get(symbol.toUpperCase());

          // If asset already exists in map, update quantities
          if (assetMap.has(symbol)) {
            const existingAsset = assetMap.get(symbol);
            existingAsset.quantity += quantity;
            existingAsset.usdValue += usdValue;
            // Recalculate average price
            existingAsset.price = existingAsset.quantity > 0 ? existingAsset.usdValue / existingAsset.quantity : 0;
          } else {
            // Create new asset entry
            assetMap.set(symbol, {
              image: coin?.image,
              name: coin?.name,
              price,
              priceChangePercentage24h: coin?.priceChangePercentage24h,
              quantity,
              symbol,
              usdValue
            });
          }
        }
      }

      // Convert map to array and sort by USD value (highest first)
      const assets = Array.from(assetMap.values()).sort((a, b) => b.usdValue - a.usdValue);

      return assets as AssetDetailsDto[];
    } catch (error) {
      this.logger.error(`Error getting asset details for user: ${user.id}`, error.stack);
      throw error;
    }
  }
}
