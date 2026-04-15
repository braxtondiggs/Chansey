import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { Cache } from 'cache-manager';
import { Decimal } from 'decimal.js';

import { ExchangeHoldingDto, UserHoldingsDto } from '@chansey/api-interfaces';

import { UsersService } from './../users/users.service';
import { AssetBalanceDto, AssetDetailsDto, BalanceResponseDto, ExchangeBalanceDto } from './dto';

import { Coin } from '../coin/coin.entity';
import { CoinService } from '../coin/coin.service';
import { USD_QUOTE_CURRENCIES } from '../exchange/constants';
import { ExchangeManagerService } from '../exchange/exchange-manager.service';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly coinService: CoinService,
    private readonly userService: UsersService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache
  ) {}

  /**
   * Get balances from all exchanges for a user
   * @param user The user to get balances for
   * @returns Balance information from all connected exchanges
   */
  async getUserBalances(user: User): Promise<BalanceResponseDto> {
    this.logger.log(`Getting balances for user: ${user.id}`);

    try {
      const currentBalances = await this.getCurrentBalances(user);
      const totalUsdValue = currentBalances.reduce((sum, exchange) => sum + exchange.totalUsdValue, 0);

      return {
        current: currentBalances,
        totalUsdValue
      };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error getting balances for user: ${user.id}`, err.stack);
      throw error;
    }
  }

  /**
   * Get user holdings for a specific coin from live exchange balances.
   * Uses balance data as source of truth for quantities/value.
   */
  async getHoldingsForCoin(user: User, coin: Coin): Promise<UserHoldingsDto | null> {
    const currentBalances = await this.getCurrentBalances(user);
    const symbol = coin.symbol.toUpperCase();

    let totalAmount = new Decimal(0);
    const exchanges: ExchangeHoldingDto[] = [];

    for (const exchange of currentBalances) {
      for (const balance of exchange.balances) {
        if (balance.asset.toUpperCase() !== symbol) continue;
        const qty = new Decimal(balance.free).plus(balance.locked);
        if (qty.lte(0)) continue;
        totalAmount = totalAmount.plus(qty);
        exchanges.push({
          exchangeName: exchange.name,
          amount: qty.toNumber(),
          lastSynced: exchange.timestamp
        });
      }
    }

    if (totalAmount.lte(0)) return null;

    const currentPrice = new Decimal(coin.currentPrice || 0);
    const currentValue = totalAmount.times(currentPrice);

    return {
      coinSymbol: coin.symbol,
      totalAmount: totalAmount.toNumber(),
      averageBuyPrice: 0,
      currentValue: currentValue.toNumber(),
      profitLoss: 0,
      profitLossPercent: 0,
      exchanges
    };
  }

  /**
   * Get current balances from all connected exchanges in parallel.
   * Results are cached in Redis for 60 seconds to avoid hammering exchange APIs.
   */
  async getCurrentBalances(user: User): Promise<ExchangeBalanceDto[]> {
    const cacheKey = `balance:user:${user.id}:current`;
    const CACHE_TTL = 60_000; // 60 seconds in ms

    const cached = await this.cacheManager.get<ExchangeBalanceDto[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Balance cache HIT for user ${user.id}`);
      return cached;
    }

    this.logger.debug(`Balance cache MISS for user ${user.id}, fetching from exchanges`);

    const exchanges = await this.userService.getExchangeKeysForUser(user.id);
    const activeExchanges = exchanges.filter((e) => e.isActive);

    const results = await Promise.allSettled(
      activeExchanges.map((exchange) => this.fetchExchangeBalance(exchange, user))
    );

    const balances = results.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      const err = toErrorInfo(result.reason);
      this.logger.error(`Error getting balances from ${activeExchanges[i].name}: ${err.message}`, err.stack);
      return this.buildExchangeBalanceDto(activeExchanges[i]);
    });

    await this.cacheManager.set(cacheKey, balances, CACHE_TTL);
    return balances;
  }

  /**
   * Fetch balance for a single exchange
   */
  private async fetchExchangeBalance(
    exchange: { exchangeId: string; slug: string; name: string },
    user: User
  ): Promise<ExchangeBalanceDto> {
    let exchangeService;
    try {
      exchangeService = this.exchangeManagerService.getExchangeService(exchange.slug);
    } catch (serviceError: unknown) {
      const err = toErrorInfo(serviceError);
      this.logger.warn(`No handler for exchange: ${exchange.slug} - ${err.message}`);
      return this.buildExchangeBalanceDto(exchange);
    }

    let balances: AssetBalanceDto[];
    try {
      balances = await exchangeService.getBalance(user);
    } catch (balanceError: unknown) {
      const err = toErrorInfo(balanceError);
      this.logger.warn(`Error getting balances from ${exchange.name}: ${err.message}`);
      return this.buildExchangeBalanceDto(exchange);
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
      const err = toErrorInfo(calcError);
      this.logger.error(`Error calculating USD values for ${exchange.name}: ${err.message}`);
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
   * Calculate USD values for each asset in parallel (returns new array, does not mutate input)
   */
  private async calculateUsdValues(balances: AssetBalanceDto[], exchangeSlug: string): Promise<AssetBalanceDto[]> {
    const quoteAsset = this.exchangeManagerService.getQuoteAsset(exchangeSlug);

    return Promise.all(
      balances.map(async (balance): Promise<AssetBalanceDto> => {
        const totalAmount = new Decimal(balance.free).plus(balance.locked);

        if (USD_QUOTE_CURRENCIES.has(balance.asset.toUpperCase())) {
          return { ...balance, usdValue: totalAmount.toNumber() };
        }

        const symbol = `${balance.asset}/${quoteAsset}`;
        try {
          const response = await this.exchangeManagerService.getPrice(exchangeSlug, symbol);
          return { ...balance, usdValue: totalAmount.times(response.price).toNumber() };
        } catch (priceError: unknown) {
          const err = toErrorInfo(priceError);
          this.logger.warn(`Unable to get price for ${symbol} on ${exchangeSlug}: ${err.message}`);
          return { ...balance, usdValue: 0 };
        }
      })
    );
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
          const quantity = new Decimal(balance.free).plus(balance.locked);
          if (quantity.lte(0)) continue;

          const symbol = balance.asset;
          const usdValue = new Decimal(balance.usdValue ?? 0);

          const existing = assetMap.get(symbol);
          if (existing) {
            const newQty = new Decimal(existing.quantity).plus(quantity);
            const newUsd = new Decimal(existing.usdValue).plus(usdValue);
            existing.quantity = newQty.toNumber();
            existing.usdValue = newUsd.toNumber();
            existing.price = newQty.gt(0) ? newUsd.div(newQty).toNumber() : 0;
          } else {
            const coin = coinDetailsMap.get(symbol.toUpperCase());
            assetMap.set(symbol, {
              image: coin?.image ?? undefined,
              name: coin?.name ?? symbol,
              slug: coin?.slug ?? symbol.toLowerCase(),
              price: quantity.gt(0) ? usdValue.div(quantity).toNumber() : 0,
              priceChangePercentage24h: coin?.priceChangePercentage24h ?? 0,
              quantity: quantity.toNumber(),
              symbol,
              usdValue: usdValue.toNumber()
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
