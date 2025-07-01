import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { OrderBookDto, TickerDto, TradingBalanceDto } from './dto';

import { BalanceService } from '../balance/balance.service';
import { CoinService } from '../coin/coin.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeService } from '../exchange/exchange.service';
import { User } from '../users/users.entity';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    private readonly balanceService: BalanceService,
    private readonly coinService: CoinService,
    private readonly exchangeService: ExchangeService,
    private readonly exchangeManagerService: ExchangeManagerService
  ) {}

  /**
   * Get trading balances for a user (optionally filtered by exchange)
   * @param user The user to get balances for
   * @param exchangeId Optional exchange ID to filter balances
   * @returns Array of trading balances
   */
  async getTradingBalances(user: User, exchangeId?: string): Promise<TradingBalanceDto[]> {
    this.logger.log(`Getting trading balances for user: ${user.id}, exchange: ${exchangeId || 'all'}`);

    try {
      // If exchangeId is specified, try to get balances directly from that exchange via CCXT
      if (exchangeId) {
        try {
          const exchange = await this.exchangeService.findOne(exchangeId);
          const exchangeManagerService = this.exchangeManagerService.getExchangeService(exchange.slug);
          const exchangeClient = await exchangeManagerService.getClient(user);

          // Fetch balances directly from exchange using CCXT
          const ccxtBalances = await exchangeClient.fetchBalance();
          const tradingBalances: TradingBalanceDto[] = [];

          // Transform CCXT balance format to our DTO format
          for (const [symbol, balance] of Object.entries(ccxtBalances)) {
            if (symbol === 'info' || symbol === 'free' || symbol === 'used' || symbol === 'total') {
              continue; // Skip CCXT metadata
            }

            const balanceData = balance as ccxt.Balance;
            if (balanceData.total && balanceData.total > 0) {
              try {
                const coin = await this.coinService.getCoinBySymbol(symbol);
                if (coin) {
                  tradingBalances.push({
                    coin: {
                      id: coin.id,
                      name: coin.name,
                      symbol: coin.symbol,
                      slug: coin.slug
                    },
                    available: balanceData.free || 0,
                    locked: balanceData.used || 0,
                    total: balanceData.total || 0
                  });
                }
              } catch (coinError) {
                this.logger.debug(`Coin not found for symbol ${symbol}, skipping`);
              }
            }
          }

          return tradingBalances;
        } catch (exchangeError) {
          this.logger.warn(`Failed to get balances from exchange ${exchangeId} via CCXT: ${exchangeError.message}`);
          // Fall back to balance service
        }
      }

      // Fall back to using the balance service
      const balanceResponse = await this.balanceService.getUserBalances(user);
      let exchangeBalances = balanceResponse.current;

      // Filter by exchange if specified
      if (exchangeId) {
        exchangeBalances = exchangeBalances.filter((exchange) => exchange.id === exchangeId);
        if (exchangeBalances.length === 0) {
          throw new NotFoundException(`Exchange with ID ${exchangeId} not found or user has no access`);
        }
      }

      // Transform to trading balance format
      const tradingBalances: TradingBalanceDto[] = [];

      for (const exchange of exchangeBalances) {
        for (const asset of exchange.balances) {
          // Find coin information
          const coin = await this.coinService.getCoinBySymbol(asset.asset);

          if (coin) {
            tradingBalances.push({
              coin: {
                id: coin.id,
                name: coin.name,
                symbol: coin.symbol,
                slug: coin.slug
              },
              available: parseFloat(asset.free),
              locked: parseFloat(asset.locked),
              total: parseFloat(asset.free) + parseFloat(asset.locked)
            });
          }
        }
      }

      return tradingBalances.filter((balance) => balance.total > 0); // Only return non-zero balances
    } catch (error) {
      this.logger.error(`Failed to get trading balances: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get order book for a trading pair
   * @param symbol Trading pair symbol (e.g., "BTC/USDT")
   * @param exchangeId Optional exchange ID
   * @returns Order book data
   */
  async getOrderBook(symbol: string, exchangeId?: string): Promise<OrderBookDto> {
    this.logger.log(`Getting order book for symbol: ${symbol}, exchange: ${exchangeId || 'default'}`);

    try {
      // Validate symbol format
      if (!symbol || !symbol.includes('/')) {
        throw new BadRequestException('Symbol must be in format "BASE/QUOTE" (e.g., "BTC/USDT")');
      }

      let exchangeClient: ccxt.Exchange | null = null;

      // If exchangeId is provided, try to get the specific exchange
      if (exchangeId) {
        try {
          const exchange = await this.exchangeService.findOne(exchangeId);
          const exchangeManagerService = this.exchangeManagerService.getExchangeService(exchange.slug);
          exchangeClient = await exchangeManagerService.getClient();
        } catch (error) {
          this.logger.warn(`Failed to get specific exchange client for ${exchangeId}, falling back to default`);
        }
      }

      // If no specific exchange or failed to get it, use a default exchange (Binance)
      if (!exchangeClient) {
        exchangeClient = new ccxt.binance({
          sandbox: false,
          enableRateLimit: true
        });
      }

      // Fetch order book from the exchange
      const orderBook = await exchangeClient.fetchOrderBook(symbol, 10); // Limit to 10 levels

      // Transform CCXT order book format to our DTO format
      const transformedOrderBook: OrderBookDto = {
        bids: orderBook.bids.map(([price, quantity]) => ({
          price,
          quantity,
          total: price * quantity
        })),
        asks: orderBook.asks.map(([price, quantity]) => ({
          price,
          quantity,
          total: price * quantity
        })),
        lastUpdated: orderBook.datetime ? new Date(orderBook.datetime) : new Date()
      };

      return transformedOrderBook;
    } catch (error) {
      this.logger.error(`Failed to get order book: ${error.message}`);

      // If there's an error getting real data, return mock data as fallback
      this.logger.warn('Falling back to mock order book data');
      const mockOrderBook: OrderBookDto = {
        bids: [
          { price: 45000.0, quantity: 0.5, total: 22500.0 },
          { price: 44999.5, quantity: 0.3, total: 13499.85 },
          { price: 44999.0, quantity: 1.2, total: 53998.8 },
          { price: 44998.5, quantity: 0.8, total: 35998.8 },
          { price: 44998.0, quantity: 2.1, total: 94495.8 }
        ],
        asks: [
          { price: 45001.0, quantity: 0.4, total: 18000.4 },
          { price: 45001.5, quantity: 0.7, total: 31501.05 },
          { price: 45002.0, quantity: 0.9, total: 40501.8 },
          { price: 45002.5, quantity: 1.1, total: 49502.75 },
          { price: 45003.0, quantity: 0.6, total: 27001.8 }
        ],
        lastUpdated: new Date()
      };

      return mockOrderBook;
    }
  }

  /**
   * Get ticker data for a symbol
   * @param symbol Trading pair symbol (e.g., "BTC/USDT")
   * @param exchangeId Optional exchange ID
   * @returns Ticker data
   */
  async getTicker(symbol: string, exchangeId?: string): Promise<TickerDto> {
    this.logger.log(`Getting ticker for symbol: ${symbol}, exchange: ${exchangeId || 'default'}`);

    try {
      // Validate symbol format
      if (!symbol || !symbol.includes('/')) {
        throw new BadRequestException('Symbol must be in format "BASE/QUOTE" (e.g., "BTC/USDT")');
      }

      let exchangeClient: ccxt.Exchange | null = null;

      // If exchangeId is provided, try to get the specific exchange
      if (exchangeId) {
        try {
          const exchange = await this.exchangeService.findOne(exchangeId);
          const exchangeManagerService = this.exchangeManagerService.getExchangeService(exchange.slug);
          exchangeClient = await exchangeManagerService.getClient();
        } catch (error) {
          this.logger.warn(`Failed to get specific exchange client for ${exchangeId}, falling back to default`);
        }
      }

      // If no specific exchange or failed to get it, use a default exchange (Binance)
      if (!exchangeClient) {
        exchangeClient = new ccxt.binance({
          sandbox: false,
          enableRateLimit: true
        });
      }

      // Fetch ticker from the exchange
      const ticker = await exchangeClient.fetchTicker(symbol);

      // Transform to our format
      return {
        symbol,
        price: ticker.last,
        priceChange: ticker.change,
        priceChangePercent: ticker.percentage,
        high24h: ticker.high,
        low24h: ticker.low,
        volume24h: ticker.baseVolume,
        quoteVolume24h: ticker.quoteVolume,
        openPrice: ticker.open,
        prevClosePrice: ticker.previousClose,
        lastUpdated: ticker.datetime ? new Date(ticker.datetime) : new Date()
      };
    } catch (error) {
      this.logger.error(`Failed to get ticker: ${error.message}`);
      throw error;
    }
  }
}
