import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { OrderBookDto, TickerDto, TradingBalanceDto } from './dto';

import { BalanceService } from '../balance/balance.service';
import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { CCXT_BALANCE_META_KEYS } from '../exchange/ccxt-balance.util';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { ExchangeService } from '../exchange/exchange.service';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

@Injectable()
export class TradingService {
  private static readonly DEFAULT_PUBLIC_EXCHANGE = { slug: 'binance_us', name: 'Binance US' } as const;
  private readonly logger = new Logger(TradingService.name);

  constructor(
    private readonly balanceService: BalanceService,
    private readonly coinService: CoinService,
    private readonly exchangeService: ExchangeService,
    private readonly exchangeManagerService: ExchangeManagerService
  ) {}

  async getTradingBalances(user: User, exchangeId?: string): Promise<TradingBalanceDto[]> {
    this.logger.log(`Getting trading balances for user: ${user.id}, exchange: ${exchangeId || 'all'}`);

    try {
      if (exchangeId) {
        const ccxtBalances = await this.fetchCcxtBalances(user, exchangeId);
        if (ccxtBalances) return ccxtBalances;
      }

      return this.fetchBalancesFromService(user, exchangeId);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get trading balances: ${err.message}`);
      throw error;
    }
  }

  async getOrderBook(symbol: string, exchangeId?: string): Promise<OrderBookDto> {
    this.logger.log(`Getting order book for symbol: ${symbol}, exchange: ${exchangeId || 'default'}`);

    this.validateSymbol(symbol);

    try {
      const { client, name: exchangeName } = await this.resolveExchangeClient(exchangeId);

      if (!client.markets) {
        await client.loadMarkets();
      }

      if (!client.markets[symbol]) {
        throw new BadRequestException(
          `Trading pair ${symbol} is not available on ${exchangeName}. Please select a different trading pair or exchange.`
        );
      }

      const market = client.markets[symbol];
      if (!market.active) {
        throw new BadRequestException(
          `Trading for ${symbol} is currently suspended on ${exchangeName}. Please try a different trading pair.`
        );
      }

      const orderBook = await client.fetchOrderBook(symbol, 10);

      return {
        bids: orderBook.bids.map(([price, quantity]) => this.toOrderBookEntry(price, quantity)),
        asks: orderBook.asks.map(([price, quantity]) => this.toOrderBookEntry(price, quantity)),
        lastUpdated: orderBook.datetime ? new Date(orderBook.datetime) : new Date()
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;

      const err = toErrorInfo(error);
      this.logger.error(`Failed to get order book: ${err.message}`);
      throw new BadRequestException(
        `Unable to fetch order book data. ${err.message || 'Exchange may be unavailable.'}`
      );
    }
  }

  async getTicker(symbol: string, exchangeId?: string): Promise<TickerDto> {
    this.logger.log(`Getting ticker for symbol: ${symbol}, exchange: ${exchangeId || 'default'}`);

    this.validateSymbol(symbol);

    try {
      const { client } = await this.resolveExchangeClient(exchangeId);
      const ticker = await client.fetchTicker(symbol);

      return {
        symbol,
        price: Number(ticker.last ?? 0),
        priceChange: ticker.change != null ? Number(ticker.change) : undefined,
        priceChangePercent: ticker.percentage != null ? Number(ticker.percentage) : undefined,
        high24h: ticker.high != null ? Number(ticker.high) : undefined,
        low24h: ticker.low != null ? Number(ticker.low) : undefined,
        volume24h: ticker.baseVolume != null ? Number(ticker.baseVolume) : undefined,
        quoteVolume24h: ticker.quoteVolume != null ? Number(ticker.quoteVolume) : undefined,
        openPrice: ticker.open != null ? Number(ticker.open) : undefined,
        prevClosePrice: ticker.previousClose != null ? Number(ticker.previousClose) : undefined,
        lastUpdated: ticker.datetime ? new Date(ticker.datetime) : new Date()
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to get ticker: ${err.message}`);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private validateSymbol(symbol: string): void {
    if (!symbol || !symbol.includes('/')) {
      throw new BadRequestException('Symbol must be in format "BASE/QUOTE" (e.g., "BTC/USDT")');
    }
  }

  /**
   * Resolve an exchange CCXT client, falling back to a keyless public client.
   */
  private async resolveExchangeClient(exchangeId?: string): Promise<{ client: ccxt.Exchange; name: string }> {
    if (exchangeId) {
      try {
        const exchange = await this.exchangeService.findOne(exchangeId);
        const service = this.exchangeManagerService.getExchangeService(exchange.slug);
        return { client: await service.getClient(), name: exchange.name };
      } catch (error: unknown) {
        this.logger.warn(`Failed to get exchange client for ${exchangeId}, falling back to public client`);
      }
    }

    const { slug, name } = TradingService.DEFAULT_PUBLIC_EXCHANGE;
    return {
      client: await this.exchangeManagerService.getPublicClient(slug),
      name
    };
  }

  /**
   * Try to fetch balances directly from an exchange via CCXT.
   * Returns null when the attempt fails so the caller can fall back.
   */
  private async fetchCcxtBalances(user: User, exchangeId: string): Promise<TradingBalanceDto[] | null> {
    try {
      const exchange = await this.exchangeService.findOne(exchangeId);
      const service = this.exchangeManagerService.getExchangeService(exchange.slug);
      const client = await service.getClient(user);
      const ccxtBalances = await client.fetchBalance();

      const balances: TradingBalanceDto[] = [];

      for (const [symbol, balance] of Object.entries(ccxtBalances)) {
        if (CCXT_BALANCE_META_KEYS.has(symbol)) continue;

        const balanceData = balance as ccxt.Balance;
        if (!balanceData.total || balanceData.total <= 0) continue;

        const coin = await this.coinService.getCoinBySymbol(symbol);
        if (!coin) continue;

        balances.push(this.toTradingBalance(coin, balanceData.free || 0, balanceData.used || 0, balanceData.total));
      }

      return balances;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to get balances from exchange ${exchangeId} via CCXT: ${err.message}`);
      return null;
    }
  }

  /**
   * Fetch balances via the internal BalanceService (DB-backed).
   */
  private async fetchBalancesFromService(user: User, exchangeId?: string): Promise<TradingBalanceDto[]> {
    const balanceResponse = await this.balanceService.getUserBalances(user);
    let exchangeBalances = balanceResponse.current;

    if (exchangeId) {
      exchangeBalances = exchangeBalances.filter((e) => e.id === exchangeId);
      if (exchangeBalances.length === 0) {
        throw new NotFoundException(`Exchange with ID ${exchangeId} not found or user has no access`);
      }
    }

    const balances: TradingBalanceDto[] = [];

    for (const exchange of exchangeBalances) {
      for (const asset of exchange.balances) {
        const coin = await this.coinService.getCoinBySymbol(asset.asset);
        if (!coin) continue;

        const free = parseFloat(asset.free);
        const locked = parseFloat(asset.locked);
        const total = free + locked;
        if (total <= 0) continue;

        balances.push(this.toTradingBalance(coin, free, locked, total));
      }
    }

    return balances;
  }

  private toTradingBalance(coin: Coin, available: number, locked: number, total: number): TradingBalanceDto {
    return {
      coin: { id: coin.id, name: coin.name, symbol: coin.symbol, slug: coin.slug },
      available,
      locked,
      total
    };
  }

  private toOrderBookEntry(price: number | undefined, quantity: number | undefined) {
    const p = Number(price ?? 0);
    const q = Number(quantity ?? 0);
    return { price: p, quantity: q, total: p * q };
  }
}
