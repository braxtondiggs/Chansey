import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { toErrorInfo } from '../../shared/error.util';
import { OrderStatusHistory, OrderTransitionReason } from '../entities/order-status-history.entity';
import { OrderStatus } from '../order.entity';

/**
 * Valid state transitions for order status.
 * Based on exchange order lifecycle.
 */
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.NEW]: [
    OrderStatus.PARTIALLY_FILLED,
    OrderStatus.FILLED,
    OrderStatus.CANCELED,
    OrderStatus.REJECTED,
    OrderStatus.EXPIRED,
    OrderStatus.PENDING_CANCEL
  ],
  [OrderStatus.PARTIALLY_FILLED]: [OrderStatus.FILLED, OrderStatus.CANCELED, OrderStatus.PENDING_CANCEL],
  [OrderStatus.PENDING_CANCEL]: [
    OrderStatus.CANCELED,
    OrderStatus.FILLED // Order can still fill while cancel is pending
  ],
  // Terminal states - no outgoing transitions
  [OrderStatus.FILLED]: [],
  [OrderStatus.CANCELED]: [],
  [OrderStatus.REJECTED]: [],
  [OrderStatus.EXPIRED]: []
};

/**
 * Terminal states that indicate order lifecycle is complete
 */
const TERMINAL_STATES: OrderStatus[] = [
  OrderStatus.FILLED,
  OrderStatus.CANCELED,
  OrderStatus.REJECTED,
  OrderStatus.EXPIRED
];

export interface TransitionResult {
  valid: boolean;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  reason: OrderTransitionReason;
  historyRecord?: OrderStatusHistory;
}

/**
 * Service for managing order state transitions with validation and history tracking.
 *
 * IMPORTANT: Invalid transitions are logged as warnings but NOT blocked.
 * The exchange is authoritative - if it says an order is in a certain state,
 * we accept that state even if it doesn't match our expected transition rules.
 */
@Injectable()
export class OrderStateMachineService {
  private readonly logger = new Logger(OrderStateMachineService.name);

  constructor(
    @InjectRepository(OrderStatusHistory)
    private readonly historyRepository: Repository<OrderStatusHistory>
  ) {}

  /**
   * Check if a transition is valid according to the state machine rules.
   */
  isValidTransition(fromStatus: OrderStatus | null, toStatus: OrderStatus): boolean {
    // Initial creation (null -> NEW) is always valid
    if (fromStatus === null) {
      return toStatus === OrderStatus.NEW;
    }

    // Same status is not a transition (no-op)
    if (fromStatus === toStatus) {
      return true;
    }

    const allowedTransitions = VALID_TRANSITIONS[fromStatus] || [];
    return allowedTransitions.includes(toStatus);
  }

  /**
   * Check if a status is a terminal state (no further transitions possible).
   */
  isTerminalState(status: OrderStatus): boolean {
    return TERMINAL_STATES.includes(status);
  }

  /**
   * Attempt a status transition with validation and history recording.
   *
   * IMPORTANT: Invalid transitions are LOGGED but NOT blocked (exchange is authoritative).
   *
   * @param orderId - The order ID
   * @param fromStatus - The current status (null for initial creation)
   * @param toStatus - The new status
   * @param reason - The reason for the transition
   * @param metadata - Optional additional context
   * @returns TransitionResult with validation status and history record
   */
  async transitionStatus(
    orderId: string,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    reason: OrderTransitionReason,
    metadata?: Record<string, unknown>
  ): Promise<TransitionResult> {
    const isValid = this.isValidTransition(fromStatus, toStatus);

    // Log invalid transitions as warnings but do NOT block
    if (!isValid) {
      this.logger.warn(
        `Invalid order state transition detected: ${fromStatus} -> ${toStatus} ` +
          `for order ${orderId}. Reason: ${reason}. ` +
          `Exchange data is authoritative, allowing transition.`,
        { orderId, fromStatus, toStatus, reason, metadata }
      );
    }

    // Always record the transition in history
    const historyRecord = await this.recordTransition(orderId, fromStatus, toStatus, reason, metadata, !isValid);

    return {
      valid: isValid,
      fromStatus,
      toStatus,
      reason,
      historyRecord
    };
  }

  /**
   * Record a status transition in the history table.
   */
  private async recordTransition(
    orderId: string,
    fromStatus: OrderStatus | null,
    toStatus: OrderStatus,
    reason: OrderTransitionReason,
    metadata?: Record<string, unknown>,
    wasInvalid?: boolean
  ): Promise<OrderStatusHistory> {
    const enrichedMetadata = {
      ...metadata,
      ...(wasInvalid && { invalidTransition: true })
    };

    const historyEntry = this.historyRepository.create({
      orderId,
      fromStatus,
      toStatus,
      reason,
      metadata: Object.keys(enrichedMetadata).length > 0 ? enrichedMetadata : null
    });

    try {
      const saved = await this.historyRepository.save(historyEntry);
      this.logger.debug(`Recorded status transition: ${fromStatus ?? 'null'} -> ${toStatus} for order ${orderId}`);
      return saved;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      // History recording should not block order updates
      this.logger.error(`Failed to record status history for order ${orderId}: ${err.message}`, err.stack);
      throw error;
    }
  }

  /**
   * Get status history for an order in chronological order.
   */
  async getOrderHistory(orderId: string): Promise<OrderStatusHistory[]> {
    return this.historyRepository.find({
      where: { orderId },
      order: { transitionedAt: 'ASC' }
    });
  }

  /**
   * Get the most recent status transition for an order.
   */
  async getLatestTransition(orderId: string): Promise<OrderStatusHistory | null> {
    return this.historyRepository.findOne({
      where: { orderId },
      order: { transitionedAt: 'DESC' }
    });
  }

  /**
   * Count transitions by reason for analytics.
   */
  async countTransitionsByReason(startDate?: Date, endDate?: Date): Promise<Record<string, number>> {
    const qb = this.historyRepository
      .createQueryBuilder('history')
      .select('history.reason', 'reason')
      .addSelect('COUNT(*)', 'count')
      .groupBy('history.reason');

    if (startDate) {
      qb.andWhere('history.transitionedAt >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('history.transitionedAt <= :endDate', { endDate });
    }

    const results = await qb.getRawMany();

    return results.reduce(
      (acc, row) => {
        acc[row.reason] = parseInt(row.count, 10);
        return acc;
      },
      {} as Record<string, number>
    );
  }

  /**
   * Find orders with invalid transitions (for monitoring and debugging).
   */
  async findInvalidTransitions(limit = 100): Promise<OrderStatusHistory[]> {
    return this.historyRepository
      .createQueryBuilder('history')
      .where("history.metadata->>'invalidTransition' = 'true'")
      .orderBy('history.transitionedAt', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Get valid next states for a given status.
   * Useful for UI/documentation purposes.
   */
  getValidNextStates(currentStatus: OrderStatus): OrderStatus[] {
    return VALID_TRANSITIONS[currentStatus] || [];
  }
}
