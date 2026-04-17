import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { PositionExitStatus } from '../../order/interfaces/exit-config.interface';
import { ORDER_EVENTS, PositionExitFilledPayload } from '../../order/interfaces/order-events.interface';
import { Order } from '../../order/order.entity';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { ListingPositionStatus, ListingTradePosition } from '../entities/listing-trade-position.entity';
import { ListingHedgeService } from '../services/listing-hedge.service';

/**
 * Reacts to OCO fills on listing-tracker spot entries:
 *  - Maps the `PositionExit` outcome back to a `ListingPositionStatus`
 *  - Closes any open Kraken Futures short hedge
 *
 * Trailing fills are treated as take-profit-style exits (`EXITED_TP`) — the
 * position is being closed for a profit-locking reason, and the existing enum
 * doesn't distinguish trailing from TP. Adding `EXITED_TRAILING` would require
 * a migration and buys little analytical value for the current use case.
 */
@Injectable()
export class ListingExitListener {
  private readonly logger = new Logger(ListingExitListener.name);

  constructor(
    @InjectRepository(ListingTradePosition)
    private readonly positionRepo: Repository<ListingTradePosition>,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly hedgeService: ListingHedgeService
  ) {}

  @OnEvent(ORDER_EVENTS.POSITION_EXIT_FILLED, { async: true })
  async handlePositionExitFilled(payload: PositionExitFilledPayload): Promise<void> {
    try {
      const position = await this.positionRepo.findOne({ where: { orderId: payload.entryOrderId } });
      if (!position) return;

      const nextStatus = this.mapStatus(payload.status);
      if (!nextStatus) return;

      const reason = payload.status;
      position.status = nextStatus;
      position.metadata = {
        ...(position.metadata ?? {}),
        closedReason: reason,
        closedAt: new Date().toISOString(),
        exitPrice: payload.exitPrice ?? undefined,
        realizedPnL: payload.realizedPnL ?? undefined
      };
      await this.positionRepo.save(position);

      if (position.hedgeOrderId) {
        const [hedgeOrder, user] = await Promise.all([
          this.orderRepo.findOne({ where: { id: position.hedgeOrderId } }),
          this.userRepo.findOne({ where: { id: payload.userId } })
        ]);
        if (hedgeOrder && user) {
          await this.hedgeService.closeShort(user, hedgeOrder);
        } else {
          this.logger.warn(`Cannot close hedge for listing position ${position.id}: hedgeOrder or user missing`);
        }
      }
    } catch (error) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to handle position-exit-filled for order ${payload.entryOrderId}: ${err.message}`,
        err.stack
      );
    }
  }

  private mapStatus(status: PositionExitStatus): ListingPositionStatus | null {
    switch (status) {
      case PositionExitStatus.STOP_LOSS_TRIGGERED:
        return ListingPositionStatus.EXITED_SL;
      case PositionExitStatus.TAKE_PROFIT_TRIGGERED:
      case PositionExitStatus.TRAILING_TRIGGERED:
        return ListingPositionStatus.EXITED_TP;
      default:
        return null;
    }
  }
}
