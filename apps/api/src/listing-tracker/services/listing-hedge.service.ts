import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { Order, OrderSide, OrderStatus, OrderType } from '../../order/order.entity';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { ListingHedgeConfig } from '../constants/risk-config';
import { ListingTradePosition } from '../entities/listing-trade-position.entity';

const KRAKEN_FUTURES_SLUG = 'kraken_futures';

@Injectable()
export class ListingHedgeService {
  private readonly logger = new Logger(ListingHedgeService.name);

  constructor(
    @InjectRepository(ListingTradePosition)
    private readonly positionRepo: Repository<ListingTradePosition>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @Inject(forwardRef(() => ExchangeManagerService))
    private readonly exchangeManagerService: ExchangeManagerService,
    @Inject(forwardRef(() => ExchangeKeyService))
    private readonly exchangeKeyService: ExchangeKeyService
  ) {}

  /**
   * Open a short hedge on Kraken Futures mirroring the spot position.
   *
   * Silently no-ops when:
   * - `hedge.enabled` is false
   * - the user has no active kraken_futures key
   * - the entry spot order has no filled quantity
   */
  async openShort(
    user: User,
    spotOrder: Order,
    hedgeConfig: ListingHedgeConfig,
    positionId: string
  ): Promise<Order | null> {
    if (!hedgeConfig.enabled) return null;

    if (hedgeConfig.requiresKrakenFutures) {
      const futuresKey = await this.findActiveKrakenFuturesKey(user.id);
      if (!futuresKey) {
        this.logger.log(`User ${user.id} has no active kraken_futures key — skipping hedge`);
        return null;
      }
    }

    const spotQuantity = spotOrder.executedQuantity || spotOrder.quantity;
    if (spotQuantity <= 0) {
      this.logger.warn(`Cannot hedge spot order ${spotOrder.id}: executedQuantity is 0`);
      return null;
    }

    const hedgeQuantity = spotQuantity * hedgeConfig.sizePct;
    const symbol = this.toFuturesSymbol(spotOrder.symbol);
    const leverage = Math.max(1, Math.min(10, hedgeConfig.leverage));

    try {
      const service = this.exchangeManagerService.getExchangeService(KRAKEN_FUTURES_SLUG);
      const ccxtOrder = await service.createFuturesOrder(user, symbol, 'sell', hedgeQuantity, leverage, {
        positionSide: 'short'
      });

      const hedgeOrder = this.orderRepo.create({
        symbol,
        orderId: ccxtOrder.id ?? '',
        clientOrderId: ccxtOrder.clientOrderId ?? '',
        transactTime: new Date(ccxtOrder.timestamp ?? Date.now()),
        quantity: hedgeQuantity,
        price: ccxtOrder.price ?? ccxtOrder.average ?? 0,
        executedQuantity: ccxtOrder.filled ?? 0,
        side: OrderSide.SELL,
        status: OrderStatus.NEW,
        type: OrderType.LIMIT,
        user,
        marketType: 'futures',
        positionSide: 'short',
        leverage,
        isAlgorithmicTrade: true,
        isManual: false
      } as Partial<Order>);

      const savedHedge = await this.orderRepo.save(hedgeOrder);

      await this.positionRepo.update({ id: positionId }, { hedgeOrderId: savedHedge.id });

      this.logger.log(
        `Opened hedge ${savedHedge.id} (qty=${hedgeQuantity}, leverage=${leverage}x) for spot ${spotOrder.id}`
      );

      return savedHedge;
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to open hedge for spot ${spotOrder.id}: ${err.message}`, err.stack);
      return null;
    }
  }

  /**
   * Close an open hedge order if present. Safe to call when no hedge exists.
   */
  async closeShort(user: User, hedgeOrder: Order): Promise<void> {
    try {
      const service = this.exchangeManagerService.getExchangeService(KRAKEN_FUTURES_SLUG);
      await service.createFuturesOrder(
        user,
        hedgeOrder.symbol,
        'buy',
        hedgeOrder.executedQuantity || hedgeOrder.quantity,
        hedgeOrder.leverage ?? 1,
        { positionSide: 'short', reduceOnly: true }
      );
      this.logger.log(`Closed hedge ${hedgeOrder.id}`);
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.warn(`Failed to close hedge ${hedgeOrder.id}: ${err.message}`);
    }
  }

  private async findActiveKrakenFuturesKey(userId: string): Promise<ExchangeKey | null> {
    const keys = await this.exchangeKeyService.findAll(userId);
    return keys.find((k) => k.isActive && k.exchange?.slug === KRAKEN_FUTURES_SLUG) ?? null;
  }

  /** Converts `FOO/USDT` → `FOO/USD:USD` for the Kraken Futures spot→perp mapping */
  private toFuturesSymbol(spotSymbol: string): string {
    const [base] = spotSymbol.split('/');
    return `${base.toUpperCase()}/USD:USD`;
  }
}
