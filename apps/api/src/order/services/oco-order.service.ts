import { Injectable, Logger } from '@nestjs/common';

import * as ccxt from 'ccxt';
import { DataSource } from 'typeorm';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { mapCcxtError } from '../../shared/ccxt-error-mapper.util';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { PlaceManualOrderDto } from '../dto/place-manual-order.dto';
import { Order, OrderStatus, OrderType } from '../order.entity';

/**
 * Creates OCO (One-Cancels-Other) order pairs with transaction safety.
 *
 * Isolates the transactional flow + rollback + critical reconciliation logging
 * from the single-order placement path.
 */
@Injectable()
export class OcoOrderService {
  private readonly logger = new Logger(OcoOrderService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly coinService: CoinService
  ) {}

  /**
   * Create OCO (One-Cancels-Other) order pair with transaction safety.
   *
   * Note: `dto.side` is the *exit* side used for BOTH legs (take-profit and stop-loss).
   * Callers are responsible for passing the correct exit side (e.g. SELL to exit a long position).
   */
  async createOcoOrder(
    dto: PlaceManualOrderDto,
    user: User,
    exchange: ccxt.Exchange,
    exchangeKey: ExchangeKey
  ): Promise<Order> {
    let takeProfitExchangeOrder: ccxt.Order | null = null;
    let stopLossExchangeOrder: ccxt.Order | null = null;

    // --- Phase 1: external exchange calls (no DB connection held) ---
    try {
      takeProfitExchangeOrder = await exchange.createOrder(
        dto.symbol,
        'limit',
        dto.side.toLowerCase(),
        dto.quantity,
        dto.takeProfitPrice
      );

      try {
        stopLossExchangeOrder = await exchange.createOrder(
          dto.symbol,
          'stop_loss',
          dto.side.toLowerCase(),
          dto.quantity,
          undefined,
          { stopPrice: dto.stopLossPrice }
        );
      } catch (stopLossError: unknown) {
        const err = toErrorInfo(stopLossError);
        this.logger.warn(`Stop-loss order failed, canceling take-profit order: ${err.message}`);
        try {
          await exchange.cancelOrder(takeProfitExchangeOrder.id, dto.symbol);
        } catch (cancelError: unknown) {
          const innerErr = toErrorInfo(cancelError);
          this.logger.error(
            `Failed to cancel take-profit order after stop-loss failure ` +
              `(symbol=${dto.symbol}, takeProfitOrderId=${takeProfitExchangeOrder.id}): ${innerErr.message}`
          );
        }
        throw stopLossError;
      }
    } catch (exchangeError: unknown) {
      const err = toErrorInfo(exchangeError);
      this.logger.error(`OCO exchange order creation failed: ${err.message}`, err.stack);
      throw mapCcxtError(exchangeError, exchangeKey.exchange.name);
    }

    // --- Phase 2: coin resolution (no DB connection held) ---
    const [baseSymbol, quoteSymbol] = dto.symbol.split('/');
    let baseCoin: Coin | null = null;
    let quoteCoin: Coin | null = null;

    try {
      const coins = await this.coinService.getMultipleCoinsBySymbol([baseSymbol, quoteSymbol]);
      baseCoin = coins.find((c) => c.symbol.toLowerCase() === baseSymbol.toLowerCase()) || null;
      quoteCoin = coins.find((c) => c.symbol.toLowerCase() === quoteSymbol.toLowerCase()) || null;
    } catch {
      this.logger.warn('Could not find coins for OCO order');
    }

    // --- Phase 3: DB transaction (short-lived, connection held only for DB I/O) ---
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();

      const tpOrder = queryRunner.manager.create(Order, {
        orderId: takeProfitExchangeOrder.id?.toString() || '',
        clientOrderId: takeProfitExchangeOrder.clientOrderId || takeProfitExchangeOrder.id?.toString() || '',
        symbol: dto.symbol,
        side: dto.side,
        type: OrderType.TAKE_PROFIT,
        quantity: dto.quantity,
        price: dto.takeProfitPrice || 0,
        executedQuantity: 0,
        status: OrderStatus.NEW,
        transactTime: new Date(),
        isManual: true,
        exchangeKeyId: dto.exchangeKeyId,
        takeProfitPrice: dto.takeProfitPrice,
        user,
        baseCoin: baseCoin && !CoinService.isVirtualCoin(baseCoin) ? baseCoin : undefined,
        quoteCoin: quoteCoin && !CoinService.isVirtualCoin(quoteCoin) ? quoteCoin : undefined,
        exchange: exchangeKey.exchange,
        info: takeProfitExchangeOrder.info
      });

      const savedTpOrder = await queryRunner.manager.save(tpOrder);

      const slOrder = queryRunner.manager.create(Order, {
        orderId: stopLossExchangeOrder.id?.toString() || '',
        clientOrderId: stopLossExchangeOrder.clientOrderId || stopLossExchangeOrder.id?.toString() || '',
        symbol: dto.symbol,
        side: dto.side,
        type: OrderType.STOP_LOSS,
        quantity: dto.quantity,
        price: 0,
        executedQuantity: 0,
        status: OrderStatus.NEW,
        transactTime: new Date(),
        isManual: true,
        exchangeKeyId: dto.exchangeKeyId,
        stopPrice: dto.stopLossPrice,
        stopLossPrice: dto.stopLossPrice,
        ocoLinkedOrderId: savedTpOrder.id,
        user,
        baseCoin: baseCoin && !CoinService.isVirtualCoin(baseCoin) ? baseCoin : undefined,
        quoteCoin: quoteCoin && !CoinService.isVirtualCoin(quoteCoin) ? quoteCoin : undefined,
        exchange: exchangeKey.exchange,
        info: stopLossExchangeOrder.info
      });

      const savedSlOrder = await queryRunner.manager.save(slOrder);

      savedTpOrder.ocoLinkedOrderId = savedSlOrder.id;
      await queryRunner.manager.save(savedTpOrder);

      await queryRunner.commitTransaction();

      this.logger.log(`OCO order pair created: TP=${savedTpOrder.id}, SL=${savedSlOrder.id}`);
      return savedTpOrder;
    } catch (dbError: unknown) {
      const err = toErrorInfo(dbError);
      await queryRunner.rollbackTransaction();

      // Both exchange orders exist (Phase 1 succeeded). Best-effort cleanup.
      try {
        await exchange.cancelOrder(takeProfitExchangeOrder.id, dto.symbol);
      } catch (cancelError: unknown) {
        const cErr = toErrorInfo(cancelError);
        this.logger.error(
          `Failed to cancel take-profit exchange order during DB rollback ` +
            `(symbol=${dto.symbol}, orderId=${takeProfitExchangeOrder.id}): ${cErr.message}`
        );
      }
      try {
        await exchange.cancelOrder(stopLossExchangeOrder.id, dto.symbol);
      } catch (cancelError: unknown) {
        const cErr = toErrorInfo(cancelError);
        this.logger.error(
          `Failed to cancel stop-loss exchange order during DB rollback ` +
            `(symbol=${dto.symbol}, orderId=${stopLossExchangeOrder.id}): ${cErr.message}`
        );
      }

      this.logger.error(
        `CRITICAL: OCO orders exist on exchange but failed to save to database. ` +
          `TP Order ID: ${takeProfitExchangeOrder.id}, SL Order ID: ${stopLossExchangeOrder.id}. ` +
          `Manual reconciliation required.`,
        err.stack
      );

      this.logger.error(`OCO order DB persistence failed: ${err.message}`, err.stack);
      throw mapCcxtError(dbError, exchangeKey.exchange.name);
    } finally {
      await queryRunner.release();
    }
  }
}
