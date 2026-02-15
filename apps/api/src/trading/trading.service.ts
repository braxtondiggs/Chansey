import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { OrderBookDto, TickerDto, TradingBalanceDto } from './dto';

import { BalanceService } from '../balance/balance.service';
import { CoinService } from '../coin/coin.service';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeService } from '../exchange/exchange.service';
import { toErrorInfo } from '../shared/error.util';
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
              } catch (coinError: unknown) {
                this.logger.debug(`Coin not found for symbol ${symbol}, skipping`);
              }
            }
          }

          return tradingBalances;
        } catch (exchangeError: unknown) {
          const exchErr = toErrorInfo(exchangeError);
          this.logger.warn(`Failed to get balances from exchange ${exchangeId} via CCXT: ${exchErr.message}`);
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
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get trading balances: ${err.message}`);
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
      let exchangeName = 'Binance';

      // If exchangeId is provided, try to get the specific exchange
      if (exchangeId) {
        try {
          const exchange = await this.exchangeService.findOne(exchangeId);
          const exchangeManagerService = this.exchangeManagerService.getExchangeService(exchange.slug);
          exchangeClient = await exchangeManagerService.getClient();
          exchangeName = exchange.name;
        } catch (error: unknown) {
          this.logger.warn(`Failed to get specific exchange client for ${exchangeId}, falling back to public client`);
        }
      }

      // If no specific exchange or failed to get it, use a public-only client
      // This is secure because it never exposes API keys - only public endpoints
      if (!exchangeClient) {
        exchangeClient = await this.exchangeManagerService.getPublicClient();
      }

      // Load markets if not already loaded
      if (!exchangeClient.markets) {
        await exchangeClient.loadMarkets();
      }

      // Validate trading pair is available on the exchange
      if (!exchangeClient.markets[symbol]) {
        throw new BadRequestException(
          `Trading pair ${symbol} is not available on ${exchangeName}. Please select a different trading pair or exchange.`
        );
      }

      // Check if the market is active
      const market = exchangeClient.markets[symbol];
      if (!market.active) {
        throw new BadRequestException(
          `Trading for ${symbol} is currently suspended on ${exchangeName}. Please try a different trading pair.`
        );
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
    } catch (error: unknown) {
      // Re-throw BadRequestException with helpful messages
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Handle other errors
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get order book: ${err.message}`);
      throw new BadRequestException(
        `Unable to fetch order book data. ${err.message || 'Exchange may be unavailable.'}`
      );
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
        } catch (error: unknown) {
          this.logger.warn(`Failed to get specific exchange client for ${exchangeId}, falling back to public client`);
        }
      }

      // If no specific exchange or failed to get it, use a public-only client
      // This is secure because it never exposes API keys - only public endpoints
      if (!exchangeClient) {
        exchangeClient = await this.exchangeManagerService.getPublicClient();
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
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get ticker: ${err.message}`);
      throw error;
    }
  }
}
