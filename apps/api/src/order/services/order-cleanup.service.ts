import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';

import { DataSource, Repository } from 'typeorm';

import { orderCleanupConfig } from '../config/order-cleanup.config';
import { PositionExit } from '../entities/position-exit.entity';
import { PositionExitStatus } from '../interfaces/exit-config.interface';
import { Order, OrderStatus } from '../order.entity';

export interface CleanupResult {
  deletedOrders: number;
  nulledPositionExitRefs: number;
  deletedPositionExits: number;
  skippedActiveRefs: number;
  dryRun: boolean;
}

/** Order statuses that are safe to clean up */
const TERMINAL_STATUSES = [OrderStatus.CANCELED, OrderStatus.REJECTED, OrderStatus.EXPIRED] as const;

/** Safety cap to prevent unbounded memory usage from candidate queries */
const MAX_CANDIDATES_PER_RUN = 50_000;

@Injectable()
export class OrderCleanupService {
  private readonly logger = new Logger(OrderCleanupService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orderRepo: Repository<Order>,
    @InjectRepository(PositionExit) private readonly positionExitRepo: Repository<PositionExit>,
    @Inject(orderCleanupConfig.KEY) private readonly config: ConfigType<typeof orderCleanupConfig>
  ) {}

  async cleanup(): Promise<CleanupResult> {
    if (!this.config.enabled) {
      this.logger.log('Order cleanup is disabled via configuration');
      return {
        deletedOrders: 0,
        nulledPositionExitRefs: 0,
        deletedPositionExits: 0,
        skippedActiveRefs: 0,
        dryRun: false
      };
    }

    const result: CleanupResult = {
      deletedOrders: 0,
      nulledPositionExitRefs: 0,
      deletedPositionExits: 0,
      skippedActiveRefs: 0,
      dryRun: this.config.dryRun
    };

    const candidateIds = await this.findCleanupCandidates();

    if (candidateIds.length === 0) {
      this.logger.log('No orders eligible for cleanup');
      return result;
    }

    if (candidateIds.length >= MAX_CANDIDATES_PER_RUN) {
      this.logger.warn(`Cleanup capped at ${MAX_CANDIDATES_PER_RUN} candidates; remainder processed next run`);
    }

    this.logger.log(`Found ${candidateIds.length} candidate orders for cleanup (dryRun=${this.config.dryRun})`);

    // Process in batches
    for (let i = 0; i < candidateIds.length; i += this.config.batchSize) {
      const batchIds = candidateIds.slice(i, i + this.config.batchSize);
      const batchResult = await this.processBatch(batchIds);

      result.deletedOrders += batchResult.deletedOrders;
      result.nulledPositionExitRefs += batchResult.nulledPositionExitRefs;
      result.deletedPositionExits += batchResult.deletedPositionExits;
      result.skippedActiveRefs += batchResult.skippedActiveRefs;

      // Delay between batches to reduce DB pressure
      if (i + this.config.batchSize < candidateIds.length) {
        await new Promise((resolve) => setTimeout(resolve, this.config.batchDelayMs));
      }
    }

    this.logger.log(
      `Cleanup complete: ${result.deletedOrders} orders deleted, ` +
        `${result.nulledPositionExitRefs} position exit refs nulled, ` +
        `${result.deletedPositionExits} position exits deleted, ` +
        `${result.skippedActiveRefs} skipped (active position refs)`
    );

    return result;
  }

  private async findCleanupCandidates(): Promise<string[]> {
    const now = new Date();

    // Terminal orders (CANCELED, REJECTED, EXPIRED) beyond retention
    const terminalCutoff = new Date(now.getTime() - this.config.terminalRetentionDays * 24 * 60 * 60 * 1000);
    const terminalOrders = await this.orderRepo
      .createQueryBuilder('order')
      .select('order.id')
      .where('order.status IN (:...statuses)', { statuses: TERMINAL_STATUSES })
      .andWhere('order.updatedAt < :cutoff', { cutoff: terminalCutoff })
      .take(MAX_CANDIDATES_PER_RUN)
      .getMany();

    // Stale PENDING_CANCEL orders beyond retention
    const pendingCancelCutoff = new Date(now.getTime() - this.config.stalePendingCancelDays * 24 * 60 * 60 * 1000);
    const pendingCancelOrders = await this.orderRepo
      .createQueryBuilder('order')
      .select('order.id')
      .where('order.status = :status', { status: OrderStatus.PENDING_CANCEL })
      .andWhere('order.updatedAt < :cutoff', { cutoff: pendingCancelCutoff })
      .take(MAX_CANDIDATES_PER_RUN)
      .getMany();

    return [...terminalOrders.map((o) => o.id), ...pendingCancelOrders.map((o) => o.id)];
  }

  private async processBatch(batchIds: string[]): Promise<Omit<CleanupResult, 'dryRun'>> {
    const batchResult = { deletedOrders: 0, nulledPositionExitRefs: 0, deletedPositionExits: 0, skippedActiveRefs: 0 };

    if (batchIds.length === 0) return batchResult;

    // Find orders referenced by ACTIVE PositionExits as entryOrderId — these must be preserved
    const activeEntryRefs = await this.positionExitRepo
      .createQueryBuilder('pe')
      .select('pe.entryOrderId')
      .where('pe.entryOrderId IN (:...ids)', { ids: batchIds })
      .andWhere('pe.status = :status', { status: PositionExitStatus.ACTIVE })
      .getMany();

    const activeEntryOrderIds = new Set(activeEntryRefs.map((pe) => pe.entryOrderId));
    batchResult.skippedActiveRefs = activeEntryOrderIds.size;

    // Remove protected orders from batch
    const deletableIds = batchIds.filter((id) => !activeEntryOrderIds.has(id));

    if (deletableIds.length === 0) {
      this.logger.debug(`Batch skipped entirely — all ${batchIds.length} orders are referenced by active positions`);
      return batchResult;
    }

    if (this.config.dryRun) {
      this.logger.log(
        `[DRY RUN] Would delete ${deletableIds.length} orders (skipped ${activeEntryOrderIds.size} active refs)`
      );
      // Count what would be affected for reporting
      const [nullableRefs, deletableExits] = await Promise.all([
        this.positionExitRepo
          .createQueryBuilder('pe')
          .where(
            'pe.stopLossOrderId IN (:...ids) OR pe.takeProfitOrderId IN (:...ids) OR pe.trailingStopOrderId IN (:...ids)',
            { ids: deletableIds }
          )
          .getCount(),
        this.positionExitRepo
          .createQueryBuilder('pe')
          .where('pe.entryOrderId IN (:...ids)', { ids: deletableIds })
          .andWhere('pe.status != :status', { status: PositionExitStatus.ACTIVE })
          .getCount()
      ]);
      batchResult.nulledPositionExitRefs = nullableRefs;
      batchResult.deletedPositionExits = deletableExits;
      batchResult.deletedOrders = deletableIds.length;
      return batchResult;
    }

    // Execute within a transaction for atomicity
    await this.dataSource.transaction(async (manager) => {
      // 1a. NULL out stopLossOrderId
      const slResult = await manager
        .createQueryBuilder()
        .update(PositionExit)
        .set({ stopLossOrderId: null })
        .where('stop_loss_order_id IN (:...ids)', { ids: deletableIds })
        .execute();

      // 1b. NULL out takeProfitOrderId
      const tpResult = await manager
        .createQueryBuilder()
        .update(PositionExit)
        .set({ takeProfitOrderId: null })
        .where('take_profit_order_id IN (:...ids)', { ids: deletableIds })
        .execute();

      // 1c. NULL out trailingStopOrderId
      const tsResult = await manager
        .createQueryBuilder()
        .update(PositionExit)
        .set({ trailingStopOrderId: null })
        .where('trailing_stop_order_id IN (:...ids)', { ids: deletableIds })
        .execute();

      batchResult.nulledPositionExitRefs =
        (slResult.affected ?? 0) + (tpResult.affected ?? 0) + (tsResult.affected ?? 0);

      // 2. Delete non-active PositionExits whose entryOrderId is being cleaned up
      const deleteExitResult = await manager
        .createQueryBuilder()
        .delete()
        .from(PositionExit)
        .where('entry_order_id IN (:...ids)', { ids: deletableIds })
        .andWhere('status != :status', { status: PositionExitStatus.ACTIVE })
        .execute();
      batchResult.deletedPositionExits = deleteExitResult.affected ?? 0;

      // 3. Delete the orders (OrderStatusHistory cascades automatically)
      const deleteResult = await manager
        .createQueryBuilder()
        .delete()
        .from(Order)
        .where('id IN (:...ids)', { ids: deletableIds })
        .execute();
      batchResult.deletedOrders = deleteResult.affected ?? 0;
    });

    return batchResult;
  }
}
