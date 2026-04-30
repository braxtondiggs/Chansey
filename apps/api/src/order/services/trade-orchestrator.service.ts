import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { In, Repository } from 'typeorm';

import { LiveTradingSignalAction, SignalReasonCode, SignalSource, SignalStatus } from '@chansey/api-interfaces';

import { TradeExecutionService } from './trade-execution.service';
import { GenerateSignalResult, TradeSignalGeneratorService } from './trade-signal-generator.service';

import { AlgorithmActivation } from '../../algorithm/algorithm-activation.entity';
import { AlgorithmActivationService } from '../../algorithm/services/algorithm-activation.service';
import { BalanceService } from '../../balance/balance.service';
import { FailedJobService } from '../../failed-jobs/failed-job.service';
import { toErrorInfo } from '../../shared/error.util';
import { ConcentrationGateService } from '../../strategy/concentration-gate.service';
import { DailyLossLimitGateService } from '../../strategy/daily-loss-limit-gate.service';
import { LiveSignalService } from '../../strategy/live-signal.service';
import { AssetAllocation } from '../../strategy/risk/concentration-check.service';
import { EntryGateService } from '../../strategy/services/entry-gate.service';
import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';
import { TradeSignalWithExit } from '../interfaces/trade-signal.interface';

export interface TradeExecutionResult {
  totalActivations: number;
  successCount: number;
  failCount: number;
  skippedCount: number;
  blockedCount: number;
  timestamp: string;
}

const CONCURRENCY_LIMIT = 5;

/**
 * Orchestrates trade execution for all active algorithm activations.
 * Handles user preflight, chunked parallel processing, gate checks, and outcome recording.
 */
@Injectable()
export class TradeOrchestratorService {
  private readonly logger = new Logger(TradeOrchestratorService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly tradeSignalGenerator: TradeSignalGeneratorService,
    private readonly entryGate: EntryGateService,
    private readonly tradeExecutionService: TradeExecutionService,
    private readonly algorithmActivationService: AlgorithmActivationService,
    private readonly balanceService: BalanceService,
    private readonly usersService: UsersService,
    private readonly concentrationGate: ConcentrationGateService,
    private readonly dailyLossLimitGate: DailyLossLimitGateService,
    private readonly failedJobService: FailedJobService,
    private readonly liveSignalService: LiveSignalService
  ) {}

  /**
   * Execute trades for all active algorithm activations.
   * @param progressCallback - Optional callback for progress updates (0-100)
   */
  async executeTrades(progressCallback?: (pct: number) => Promise<void>): Promise<TradeExecutionResult> {
    await progressCallback?.(10);

    const allActivations = await this.algorithmActivationService.findAllActiveAlgorithms();
    const activeActivations = await this.filterRoboAdvisorUsers(allActivations);

    this.logger.log(
      `Found ${allActivations.length} active activations, ${allActivations.length - activeActivations.length} ` +
        `skipped (robo-advisor users), ${activeActivations.length} to process`
    );

    if (activeActivations.length === 0) {
      return {
        totalActivations: 0,
        successCount: 0,
        failCount: 0,
        skippedCount: 0,
        blockedCount: 0,
        timestamp: new Date().toISOString()
      };
    }

    await progressCallback?.(20);

    const totalActivations = activeActivations.length;

    // Phase 1: Pre-populate caches per unique user
    const portfolioCache = new Map<string, number>();
    const balanceCache = new Map<string, AssetAllocation[]>();
    const userRiskLevels = new Map<string, number>();
    const dailyLossBlockedUsers = new Set<string>();
    const uniqueUserIds = [...new Set(activeActivations.map((a) => a.userId))];

    for (const userId of uniqueUserIds) {
      try {
        const user = await this.usersService.getById(userId);
        const balances = await this.balanceService.getUserBalances(user);
        const portfolioValue = balances.totalUsdValue || 0;
        portfolioCache.set(userId, portfolioValue);
        balanceCache.set(userId, this.concentrationGate.buildAssetAllocations(balances.current));
        userRiskLevels.set(userId, user.effectiveCalculationRiskLevel);

        const riskLevel = user.effectiveCalculationRiskLevel;
        const dailyLossCheck = await this.dailyLossLimitGate.isEntryBlocked(userId, portfolioValue, riskLevel);
        if (dailyLossCheck.blocked) {
          dailyLossBlockedUsers.add(userId);
          this.logger.warn(`Daily loss limit gate blocked user ${userId}: ${dailyLossCheck.reason}`);
        }
      } catch (error) {
        const err = toErrorInfo(error);
        this.logger.warn(`User ${userId} pre-flight failed: ${err.message}, blocking as precaution`);
        portfolioCache.set(userId, 0);
        dailyLossBlockedUsers.add(userId);
      }
    }

    // Phase 2: Group by user and process in parallel chunks
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    let blockedCount = 0;
    let processedActivations = 0;

    const groups = this.groupByUser(activeActivations);
    const chunks = this.chunkArray(groups, CONCURRENCY_LIMIT);

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map(async (group) => {
          const groupCounts = { success: 0, fail: 0, skipped: 0, blocked: 0 };
          for (const activation of group) {
            try {
              const outcome = await this.processActivation(
                activation,
                portfolioCache.get(activation.userId) ?? 0,
                dailyLossBlockedUsers,
                balanceCache,
                userRiskLevels
              );
              if (outcome === 'executed') groupCounts.success++;
              else if (outcome === 'blocked') groupCounts.blocked++;
              else groupCounts.skipped++;
            } catch (error: unknown) {
              const err = toErrorInfo(error);
              this.logger.error(`Activation ${activation.id} processing failed: ${err.message}`, err.stack);
              groupCounts.fail++;

              try {
                await this.failedJobService.recordFailure({
                  queueName: 'trade-execution',
                  jobId: `activation:${activation.id}`,
                  jobName: 'processActivation',
                  jobData: {
                    userId: activation.userId,
                    activationId: activation.id,
                    algorithmId: activation.algorithmId
                  },
                  errorMessage: err.message,
                  stackTrace: err.stack
                });
              } catch {
                // fail-safe
              }
            }
          }
          return groupCounts;
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          successCount += result.value.success;
          failCount += result.value.fail;
          skippedCount += result.value.skipped;
          blockedCount += result.value.blocked;
        } else {
          const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
          this.logger.error(`Activation group processing failed: ${reason}`, result.reason?.stack);
          failCount++;
        }
      }

      const chunkActivationCount = chunk.reduce<number>((sum, group) => sum + group.length, 0);
      processedActivations += chunkActivationCount;
      const progressPercentage = Math.floor(20 + (processedActivations / totalActivations) * 70);
      await progressCallback?.(progressPercentage);
    }

    // Prune throttle states for deactivated activations
    const activeIds = new Set(activeActivations.map((a) => a.id));
    this.tradeSignalGenerator.pruneThrottleStates(activeIds);

    await progressCallback?.(100);
    this.logger.log(
      `Trade execution complete: ${totalActivations} activations — ${successCount} executed, ${skippedCount} skipped, ${blockedCount} blocked, ${failCount} failed`
    );

    return {
      totalActivations,
      successCount,
      failCount,
      skippedCount,
      blockedCount,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Process a single activation: generate signal, check gates, execute trade.
   * @returns 'executed' if a trade was placed, 'skipped' if no signal, 'blocked' if gate rejected
   */
  private async processActivation(
    activation: AlgorithmActivation,
    portfolioValue: number,
    dailyLossBlockedUsers: Set<string>,
    balanceCache: Map<string, AssetAllocation[]>,
    userRiskLevels: Map<string, number>
  ): Promise<'executed' | 'skipped' | 'blocked'> {
    if (portfolioValue <= 0) {
      this.logger.warn(
        `Skipping activation ${activation.id}: portfolio value is $${portfolioValue} (cannot auto-size)`
      );
      return 'skipped';
    }

    const { signal, skipReason } = await this.tradeSignalGenerator.generateTradeSignal(activation, portfolioValue);

    if (signal) {
      // Run unified entry gate sequence: daily-loss → concentration → cooldown
      const gateResult = await this.entryGate.checkEntryGates({
        userId: activation.userId,
        symbol: signal.symbol,
        action: signal.action,
        positionSide: signal.positionSide,
        portfolioValue: signal.portfolioValue ?? portfolioValue,
        allocationPercentage: signal.allocationPercentage ?? 5,
        riskLevel: userRiskLevels.get(activation.userId) ?? 3,
        assets: balanceCache.get(activation.userId) ?? [],
        isDailyLossBlocked: dailyLossBlockedUsers.has(activation.userId),
        pipelineId: `activation:${activation.id}`
      });

      if (!gateResult.allowed) {
        this.logger.warn(`Gate blocked activation ${activation.id}: ${gateResult.reasonCode} — ${gateResult.reason}`);
        await this.recordActivationSignalOutcome(activation, signal, SignalStatus.BLOCKED, {
          reasonCode: gateResult.reasonCode,
          reason: gateResult.reason,
          metadata: gateResult.metadata
        });
        return 'blocked';
      }

      // Apply concentration gate's position size reduction
      if (gateResult.adjustedQuantity != null && gateResult.adjustedQuantity < 1) {
        signal.allocationPercentage = (signal.allocationPercentage ?? 5) * gateResult.adjustedQuantity;
      }

      try {
        const order = await this.tradeExecutionService.executeTradeSignal(signal);
        this.tradeSignalGenerator.markExecuted(activation.id, signal);
        await this.recordActivationSignalOutcome(activation, signal, SignalStatus.PLACED, {
          orderId: order.id,
          quantity: Number(order.executedQuantity ?? order.quantity ?? signal.quantity)
        });
        this.logger.log(
          `Executed trade for activation ${activation.id} (${activation.algorithm.name}): ${signal.action} ${signal.symbol}`
        );
        return 'executed';
      } catch (error: unknown) {
        await this.entryGate.clearCooldownOnFailure(signal.userId, signal.symbol, signal.action);
        const err = toErrorInfo(error);
        await this.recordActivationSignalOutcome(activation, signal, SignalStatus.FAILED, {
          reasonCode: SignalReasonCode.ORDER_EXECUTION_FAILED,
          reason: err.message
        });
        throw error;
      }
    }

    if (skipReason) {
      await this.recordSkippedSignalOutcome(activation, skipReason);
      return 'blocked';
    }

    this.logger.debug(`No actionable signal for activation ${activation.id} (${activation.algorithm.name})`);
    return 'skipped';
  }

  /**
   * Filter out activations belonging to robo-advisor users (algoTradingEnabled=true).
   * Those users are handled exclusively by Pipeline 1 (LiveTradingService).
   */
  private async filterRoboAdvisorUsers(activations: AlgorithmActivation[]): Promise<AlgorithmActivation[]> {
    if (activations.length === 0) return activations;

    const uniqueUserIds = [...new Set(activations.map((a) => a.userId))];

    const roboAdvisorUsers = await this.userRepo.find({
      where: { id: In(uniqueUserIds), algoTradingEnabled: true },
      select: ['id']
    });

    if (roboAdvisorUsers.length === 0) return activations;

    const roboUserIds = new Set(roboAdvisorUsers.map((u) => u.id));

    this.logger.log(
      `Filtering ${roboAdvisorUsers.length} robo-advisor user(s) from activation pipeline (handled by LiveTradingService)`
    );

    return activations.filter((a) => !roboUserIds.has(a.userId));
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private groupByUser(activations: AlgorithmActivation[]): AlgorithmActivation[][] {
    const groups = new Map<string, AlgorithmActivation[]>();
    for (const activation of activations) {
      const key = activation.userId;
      const group = groups.get(key) ?? [];
      group.push(activation);
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private async recordActivationSignalOutcome(
    activation: AlgorithmActivation,
    signal: TradeSignalWithExit,
    status: SignalStatus,
    details: {
      reasonCode?: SignalReasonCode;
      reason?: string;
      metadata?: Record<string, unknown>;
      orderId?: string;
      quantity?: number;
    }
  ): Promise<void> {
    try {
      await this.liveSignalService.recordOutcome({
        userId: activation.userId,
        algorithmActivationId: activation.id,
        action: this.toLiveSignalAction(signal.action, signal.positionSide),
        symbol: signal.symbol,
        quantity: details.quantity ?? signal.quantity,
        confidence: signal.confidence,
        status,
        reasonCode: details.reasonCode,
        reason: details.reason,
        metadata: details.metadata,
        orderId: details.orderId,
        source: SignalSource.LIVE_TRADING
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to record signal outcome for activation ${activation.id}: ${err.message}`, err.stack);
    }
  }

  private async recordSkippedSignalOutcome(
    activation: AlgorithmActivation,
    skipReason: NonNullable<GenerateSignalResult['skipReason']>
  ): Promise<void> {
    try {
      const partial = skipReason.partialSignal ?? {};
      const action = partial.action ?? 'BUY';
      const symbol = partial.symbol ?? 'UNKNOWN';
      await this.liveSignalService.recordOutcome({
        userId: activation.userId,
        algorithmActivationId: activation.id,
        action: this.toLiveSignalAction(action, partial.positionSide),
        symbol,
        quantity: 0,
        confidence: partial.confidence,
        status: SignalStatus.BLOCKED,
        reasonCode: skipReason.reasonCode,
        reason: skipReason.reason,
        metadata: skipReason.metadata,
        source: SignalSource.LIVE_TRADING
      });
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(
        `Failed to record skipped signal outcome for activation ${activation.id}: ${err.message}`,
        err.stack
      );
    }
  }

  private toLiveSignalAction(action: 'BUY' | 'SELL', positionSide?: 'long' | 'short'): LiveTradingSignalAction {
    if (positionSide === 'short') {
      return action === 'BUY' ? LiveTradingSignalAction.SHORT_EXIT : LiveTradingSignalAction.SHORT_ENTRY;
    }

    return action === 'BUY' ? LiveTradingSignalAction.BUY : LiveTradingSignalAction.SELL;
  }
}
