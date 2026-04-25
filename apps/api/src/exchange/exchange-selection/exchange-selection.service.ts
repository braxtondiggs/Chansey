import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { InvalidSymbolException } from '../../common/exceptions';
import { Order } from '../../order/order.entity';
import { toErrorInfo } from '../../shared/error.util';
import { UserStrategyPosition } from '../../strategy/entities/user-strategy-position.entity';
import { ExchangeKey } from '../exchange-key/exchange-key.entity';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../exchange-manager.service';

/**
 * ExchangeSelectionService
 *
 * Smart exchange routing for automated trading.
 * BUY orders auto-select the best exchange based on symbol support and balance.
 * SELL orders route to the exchange where the position was opened.
 */
@Injectable()
export class ExchangeSelectionService {
  private readonly logger = new Logger(ExchangeSelectionService.name);

  constructor(
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManagerService: ExchangeManagerService,
    @InjectRepository(UserStrategyPosition)
    private readonly positionRepo: Repository<UserStrategyPosition>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>
  ) {}

  /**
   * Select any active exchange key for a user without symbol-specific filtering.
   * Use when the trading symbol is not known yet (e.g., paper trading session creation
   * where symbols are determined by algorithm signals at runtime).
   */
  async selectDefault(userId: string): Promise<ExchangeKey> {
    const allKeys = await this.exchangeKeyService.findAll(userId);
    const activeKeys = allKeys.filter((k) => k.isActive);

    if (activeKeys.length === 0) {
      throw new NotFoundException(`No active exchange keys found for user ${userId}`);
    }

    return activeKeys[0];
  }

  /**
   * Select the best exchange key for a BUY order.
   * 1. Single active key → probe symbol support; throw if unsupported (no fallback)
   * 2. Multi-key → filter by symbol support (price lookup, checked in parallel)
   * 3. Return first supported key
   */
  async selectForBuy(userId: string, symbol: string): Promise<ExchangeKey> {
    const allKeys = await this.exchangeKeyService.findAll(userId);
    const activeKeys = allKeys.filter((k) => k.isActive);

    if (activeKeys.length === 0) {
      throw new NotFoundException(`No active exchange keys found for user ${userId}`);
    }

    const [base] = symbol.split('/');

    // Single active key — still probe symbol support. Throws if the only exchange doesn't list the pair.
    if (activeKeys.length === 1) {
      const only = activeKeys[0];
      const onlySlug = only.exchange?.slug;
      if (!onlySlug) {
        throw new NotFoundException(`Active exchange key for user ${userId} has no exchange slug`);
      }
      const quoteAsset = this.exchangeManagerService.getQuoteAsset(onlySlug);
      const exchangeSymbol = `${base}/${quoteAsset}`;
      try {
        await this.exchangeManagerService.getPrice(onlySlug, exchangeSymbol);
        return only;
      } catch (error) {
        const err = toErrorInfo(error);
        this.logger.warn(
          `Symbol ${exchangeSymbol} not supported on sole exchange ${onlySlug} for user ${userId}: ${err.message}`
        );
        throw new InvalidSymbolException(exchangeSymbol, onlySlug);
      }
    }

    // Check all exchanges for symbol support in parallel
    const results = await Promise.allSettled(
      activeKeys.map(async (key) => {
        const exchangeSlug = key.exchange?.slug;
        if (!exchangeSlug) throw new Error('no slug');
        // Resolve exchange-specific quote currency (e.g., USD for Coinbase, USDT for Binance)
        const quoteAsset = this.exchangeManagerService.getQuoteAsset(exchangeSlug);
        const exchangeSymbol = `${base}/${quoteAsset}`;
        await this.exchangeManagerService.getPrice(exchangeSlug, exchangeSymbol);
        return key;
      })
    );

    const firstSupported = results.find((r): r is PromiseFulfilledResult<ExchangeKey> => r.status === 'fulfilled');
    if (firstSupported) return firstSupported.value;

    // Fallback: return first active key (let the trade fail at execution if unsupported)
    this.logger.warn(`No exchange supports symbol ${symbol} for user ${userId}, falling back to first active key`);
    return activeKeys[0];
  }

  /**
   * Select the exchange key for a SELL order.
   * 1. Check UserStrategyPosition.exchangeKeyId for the position
   * 2. Fallback to most recent FILLED BUY order for user+symbol
   * 3. Final fallback to selectForBuy()
   */
  async selectForSell(userId: string, symbol: string, strategyConfigId?: string): Promise<ExchangeKey> {
    // 1. Check position record for exchange key
    if (strategyConfigId) {
      try {
        const position = await this.positionRepo.findOne({
          where: { userId, strategyConfigId, symbol },
          relations: ['exchangeKey', 'exchangeKey.exchange']
        });

        if (position?.exchangeKeyId && position.exchangeKey?.isActive) {
          return position.exchangeKey;
        }
      } catch (error) {
        const err = toErrorInfo(error);
        this.logger.debug(`Position lookup failed for sell routing: ${err.message}`);
      }
    }

    // 2. Fallback: find most recent filled BUY order for user+symbol
    try {
      const recentBuyOrder = await this.orderRepo
        .createQueryBuilder('order')
        .where('order.userId = :userId', { userId })
        .andWhere('order.symbol = :symbol', { symbol })
        .andWhere('order.side = :side', { side: 'BUY' })
        .andWhere('order.status = :status', { status: 'FILLED' })
        .andWhere('order.exchange_key_id IS NOT NULL')
        .orderBy('order.createdAt', 'DESC')
        .getOne();

      if (recentBuyOrder?.exchangeKeyId) {
        const key = await this.exchangeKeyService.findOne(recentBuyOrder.exchangeKeyId, userId);
        if (key?.isActive) {
          return key;
        }
      }
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.debug(`Order history lookup failed for sell routing: ${err.message}`);
    }

    // 3. Final fallback: use buy selection logic
    this.logger.debug(`No position/order history for sell routing, falling back to selectForBuy for ${symbol}`);
    return this.selectForBuy(userId, symbol);
  }
}
