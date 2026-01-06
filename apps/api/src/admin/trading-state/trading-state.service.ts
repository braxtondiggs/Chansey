import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { AuditEventType } from '@chansey/api-interfaces';

import { HaltTradingDto } from './dto/halt-trading.dto';
import { ResumeTradingDto } from './dto/resume-trading.dto';
import { CancelAllOrdersResponseDto } from './dto/trading-state-response.dto';
import { TradingState } from './trading-state.entity';

import { AuditService } from '../../audit/audit.service';
import { Order, OrderStatus } from '../../order/order.entity';
import { OrderService } from '../../order/order.service';
import { DeploymentService } from '../../strategy/deployment.service';

/**
 * TradingStateService
 *
 * Manages global trading state for the kill switch feature.
 * Uses singleton pattern with in-memory caching for fast trading checks.
 *
 * Critical safety feature - handles emergency trading halts.
 */
@Injectable()
export class TradingStateService implements OnModuleInit {
  private readonly logger = new Logger(TradingStateService.name);

  /** In-memory cache for fast access during trading cycles */
  private cachedState: TradingState | null = null;

  constructor(
    @InjectRepository(TradingState)
    private readonly tradingStateRepo: Repository<TradingState>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    private readonly auditService: AuditService,
    private readonly deploymentService: DeploymentService,
    private readonly orderService: OrderService
  ) {}

  /**
   * Initialize trading state on module startup.
   * Creates singleton record if it doesn't exist.
   */
  async onModuleInit(): Promise<void> {
    await this.ensureStateExists();
    await this.refreshCache();
    this.logger.log(`Trading state initialized: enabled=${this.cachedState?.tradingEnabled}`);
  }

  /**
   * Fast check if trading is enabled (uses in-memory cache).
   * Called by LiveTradingService before each execution cycle.
   *
   * @returns true if trading is enabled, false if halted
   */
  isTradingEnabled(): boolean {
    return this.cachedState?.tradingEnabled ?? true;
  }

  /**
   * Get current trading state with full details.
   */
  async getState(): Promise<TradingState> {
    await this.refreshCache();
    if (!this.cachedState) {
      throw new Error('Trading state not initialized - database may be empty');
    }
    return this.cachedState;
  }

  /**
   * Halt all trading globally.
   *
   * @param userId - Admin user who triggered the halt
   * @param dto - Halt parameters including reason
   */
  async haltTrading(userId: string, dto: HaltTradingDto): Promise<TradingState> {
    const state = await this.getState();

    if (!state.tradingEnabled) {
      this.logger.warn(`Trading already halted, skipping. Halted by ${state.haltedBy} at ${state.haltedAt}`);
      return state;
    }

    const beforeState = this.serializeState(state);

    state.tradingEnabled = false;
    state.haltedAt = new Date();
    state.haltedBy = userId;
    state.haltReason = dto.reason;
    state.haltCount += 1;
    state.metadata = {
      ...state.metadata,
      lastHaltMetadata: dto.metadata,
      haltSource: 'manual'
    };

    const saved = await this.tradingStateRepo.save(state);
    await this.refreshCache();

    // Audit log
    await this.auditService.createAuditLog({
      eventType: AuditEventType.MANUAL_INTERVENTION,
      entityType: 'TradingState',
      entityId: saved.id,
      userId,
      beforeState,
      afterState: this.serializeState(saved),
      metadata: {
        action: 'halt_trading',
        reason: dto.reason,
        pauseDeployments: dto.pauseDeployments ?? false,
        cancelOpenOrders: dto.cancelOpenOrders ?? false
      }
    });

    this.logger.error(`TRADING HALTED by user ${userId}. Reason: ${dto.reason}`);

    // Optional: Pause all deployments
    if (dto.pauseDeployments) {
      await this.pauseAllDeployments(userId, dto.reason);
    }

    // Optional: Cancel all open orders
    if (dto.cancelOpenOrders) {
      await this.cancelAllOpenOrders(userId);
    }

    return saved;
  }

  /**
   * Resume trading globally.
   *
   * @param userId - Admin user who resumed trading
   * @param dto - Resume parameters
   */
  async resumeTrading(userId: string, dto: ResumeTradingDto): Promise<TradingState> {
    const state = await this.getState();

    if (state.tradingEnabled) {
      this.logger.warn('Trading already enabled, nothing to resume');
      return state;
    }

    const beforeState = this.serializeState(state);
    const haltDurationMs = state.haltedAt ? Date.now() - state.haltedAt.getTime() : null;

    state.tradingEnabled = true;
    state.resumedAt = new Date();
    state.resumedBy = userId;
    state.resumeReason = dto.reason || null;
    state.metadata = {
      ...state.metadata,
      lastResumeMetadata: dto.metadata
    };

    const saved = await this.tradingStateRepo.save(state);
    await this.refreshCache();

    // Audit log
    await this.auditService.createAuditLog({
      eventType: AuditEventType.MANUAL_INTERVENTION,
      entityType: 'TradingState',
      entityId: saved.id,
      userId,
      beforeState,
      afterState: this.serializeState(saved),
      metadata: {
        action: 'resume_trading',
        reason: dto.reason,
        haltDurationMs
      }
    });

    this.logger.log(`TRADING RESUMED by user ${userId}. Reason: ${dto.reason || 'No reason provided'}`);

    return saved;
  }

  /**
   * Cancel all open orders across all users.
   * Used during emergency halt.
   */
  async cancelAllOpenOrders(adminUserId: string): Promise<CancelAllOrdersResponseDto> {
    this.logger.warn(`Initiating cancel-all-orders by admin ${adminUserId}`);

    // Find all open orders (NEW or PARTIALLY_FILLED)
    const openOrders = await this.orderRepo.find({
      where: {
        status: In([OrderStatus.NEW, OrderStatus.PARTIALLY_FILLED])
      },
      relations: ['user', 'exchange']
    });

    const result: CancelAllOrdersResponseDto = {
      totalOrders: openOrders.length,
      successfulCancellations: 0,
      failedCancellations: 0,
      errors: []
    };

    if (openOrders.length === 0) {
      this.logger.log('No open orders to cancel');
      return result;
    }

    this.logger.warn(`Found ${openOrders.length} open orders to cancel`);

    // Process cancellations sequentially to avoid rate limiting
    for (const order of openOrders) {
      try {
        // cancelManualOrder requires the order's user
        if (!order.user) {
          result.failedCancellations++;
          result.errors.push({
            orderId: order.id,
            userId: 'unknown',
            error: 'Order has no associated user'
          });
          continue;
        }

        await this.orderService.cancelManualOrder(order.id, order.user);
        result.successfulCancellations++;
      } catch (error) {
        result.failedCancellations++;
        result.errors.push({
          orderId: order.id,
          userId: order.user?.id || 'unknown',
          error: error instanceof Error ? error.message : String(error)
        });
        this.logger.error(`Failed to cancel order ${order.id}: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Audit log for bulk cancellation
    await this.auditService.createAuditLog({
      eventType: AuditEventType.MANUAL_INTERVENTION,
      entityType: 'Order',
      entityId: 'bulk_cancellation',
      userId: adminUserId,
      beforeState: null,
      afterState: result,
      metadata: {
        action: 'cancel_all_orders',
        totalOrders: result.totalOrders,
        successful: result.successfulCancellations,
        failed: result.failedCancellations
      }
    });

    this.logger.warn(`Cancel-all-orders complete: ${result.successfulCancellations}/${result.totalOrders} successful`);

    return result;
  }

  /**
   * Pause all active deployments.
   */
  private async pauseAllDeployments(userId: string, reason: string): Promise<void> {
    const activeDeployments = await this.deploymentService.getActiveDeployments();

    this.logger.warn(`Pausing ${activeDeployments.length} active deployments`);

    for (const deployment of activeDeployments) {
      try {
        await this.deploymentService.pauseDeployment(deployment.id, `Global trading halt: ${reason}`, userId);
      } catch (error) {
        this.logger.error(
          `Failed to pause deployment ${deployment.id}: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }

  /**
   * Ensure singleton trading state record exists.
   */
  private async ensureStateExists(): Promise<void> {
    const existing = await this.tradingStateRepo.findOne({ where: {} });

    if (!existing) {
      const initial = this.tradingStateRepo.create({
        tradingEnabled: true,
        haltCount: 0
      });
      await this.tradingStateRepo.save(initial);
      this.logger.log('Created initial trading state record');
    }
  }

  /**
   * Refresh in-memory cache from database.
   */
  private async refreshCache(): Promise<void> {
    this.cachedState = await this.tradingStateRepo.findOne({ where: {} });
  }

  /**
   * Serialize state for audit logging (convert to plain object)
   */
  private serializeState(state: TradingState): Record<string, unknown> {
    return {
      id: state.id,
      tradingEnabled: state.tradingEnabled,
      haltedAt: state.haltedAt,
      haltedBy: state.haltedBy,
      haltReason: state.haltReason,
      resumedAt: state.resumedAt,
      resumedBy: state.resumedBy,
      resumeReason: state.resumeReason,
      haltCount: state.haltCount,
      metadata: state.metadata
    };
  }
}
