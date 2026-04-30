import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { SignalReasonCode, SignalStatus } from '@chansey/api-interfaces';

import { CapitalAllocationService } from './capital-allocation.service';
import { ConcentrationGateService } from './concentration-gate.service';
import { DailyLossLimitGateService } from './daily-loss-limit-gate.service';
import { LiveSignalService } from './live-signal.service';
import { calculateFreeUsdValue, estimatePortfolioCapital, extractCoinIdFromSymbol } from './live-trading.utils';
import { OpportunitySellingExecutionService } from './opportunity-selling-execution.service';
import { OrderPlacementService } from './order-placement.service';
import { PositionTrackingService } from './position-tracking.service';
import { PreTradeRiskGateService } from './pre-trade-risk-gate.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';
import { StrategyExecutorService } from './strategy-executor.service';

import { TradingStateService } from '../admin/trading-state/trading-state.service';
import { BalanceService } from '../balance/balance.service';
import { FailedJobService } from '../failed-jobs/failed-job.service';
import { CompositeRegimeService } from '../market-regime/composite-regime.service';
import { MetricsService } from '../metrics/metrics.service';
import { SignalFilterChainService } from '../order/backtest/shared/filters';
import { LOCK_DEFAULTS, LOCK_KEYS } from '../shared/distributed-lock.constants';
import { DistributedLockService } from '../shared/distributed-lock.service';
import { toErrorInfo } from '../shared/error.util';
import { User } from '../users/users.entity';

/** Maximum consecutive errors before disabling algo trading for a user */
const MAX_ERROR_STRIKES = 3;

/**
 * Orchestrates live trading for all enrolled robo-advisor users.
 * Runs strategies every 2 minutes and places orders on user exchanges.
 */
@Injectable()
export class LiveTradingService implements OnApplicationShutdown {
  private readonly logger = new Logger(LiveTradingService.name);
  private currentLockToken: string | null = null;
  /** Tracks consecutive error count per user for strike-based disabling */
  private readonly userErrorStrikes = new Map<string, number>();

  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly riskPoolMapping: RiskPoolMappingService,
    private readonly capitalAllocation: CapitalAllocationService,
    private readonly positionTracking: PositionTrackingService,
    private readonly strategyExecutor: StrategyExecutorService,
    private readonly balanceService: BalanceService,
    private readonly lockService: DistributedLockService,
    private readonly tradingStateService: TradingStateService,
    private readonly compositeRegimeService: CompositeRegimeService,
    private readonly signalFilterChain: SignalFilterChainService,
    private readonly preTradeRiskGate: PreTradeRiskGateService,
    private readonly dailyLossLimitGate: DailyLossLimitGateService,
    private readonly concentrationGate: ConcentrationGateService,
    private readonly metricsService: MetricsService,
    private readonly failedJobService: FailedJobService,
    private readonly liveSignalService: LiveSignalService,
    private readonly orderPlacement: OrderPlacementService,
    private readonly opportunitySellingExecution: OpportunitySellingExecutionService
  ) {}

  @Cron('*/2 * * * *')
  async executeLiveTrading(): Promise<void> {
    // KILL SWITCH CHECK - must be first before any trading activity
    if (!this.tradingStateService.isTradingEnabled()) {
      this.logger.warn('Live trading is globally halted - skipping execution cycle');
      return;
    }

    const lockResult = await this.lockService.acquire({
      key: LOCK_KEYS.LIVE_TRADING,
      ttlMs: LOCK_DEFAULTS.LIVE_TRADING_TTL_MS
    });

    if (!lockResult.acquired) {
      this.logger.debug('Live trading already running on another instance, skipping this cycle');
      return;
    }

    this.currentLockToken = lockResult.token;

    try {
      const enrolledUsers = await this.userRepo.find({
        where: { algoTradingEnabled: true },
        relations: ['coinRisk']
      });

      if (enrolledUsers.length === 0) {
        this.logger.debug('No users enrolled in algo trading');
        return;
      }

      this.logger.log(`Executing strategies for ${enrolledUsers.length} enrolled users`);

      for (const user of enrolledUsers) {
        try {
          await this.executeUserStrategies(user);
          // Clear error strikes on successful execution
          this.userErrorStrikes.delete(user.id);
        } catch (error: unknown) {
          const err = toErrorInfo(error);
          this.logger.error(`Failed to execute strategies for user ${user.id}: ${err.message}`);
          await this.handleUserError(user, error);

          try {
            await this.failedJobService.recordFailure({
              queueName: 'live-trading-cron',
              jobId: `user:${user.id}`,
              jobName: 'executeUserStrategies',
              jobData: { userId: user.id },
              errorMessage: err.message,
              stackTrace: err.stack
            });
          } catch {
            // fail-safe
          }
        }
      }
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Live trading cycle failed: ${err.message}`, err.stack);
    } finally {
      await this.lockService.release(LOCK_KEYS.LIVE_TRADING, this.currentLockToken);
      this.currentLockToken = null;
    }
  }

  private async executeUserStrategies(user: User): Promise<void> {
    if (!user.algoCapitalAllocationPercentage || user.algoCapitalAllocationPercentage <= 0) {
      this.logger.debug(`User ${user.id} has no capital allocation percentage set, skipping`);
      return;
    }

    // Fetch user's free balance from exchange
    let balances = await this.balanceService.getUserBalances(user);
    const totalFreeUsdValue = calculateFreeUsdValue(balances.current);

    if (totalFreeUsdValue <= 0 && !user.enableOpportunitySelling) {
      this.logger.warn(`User ${user.id} has no free balance available`);
      return;
    }

    // When fully invested with opportunity selling enabled, use a nominal capital
    // so strategies can still generate signals (actual capital comes from selling)
    const effectiveFreeValue = totalFreeUsdValue > 0 ? totalFreeUsdValue : 0;
    const actualCapital =
      effectiveFreeValue > 0
        ? (effectiveFreeValue * Number(user.algoCapitalAllocationPercentage)) / 100
        : estimatePortfolioCapital(balances.current);

    this.logger.debug(
      `User ${user.id}: Free balance $${totalFreeUsdValue.toFixed(2)}, ` +
        `${user.algoCapitalAllocationPercentage}% = $${actualCapital.toFixed(2)} for algo trading`
    );

    const strategies = await this.riskPoolMapping.getActiveStrategiesForUser(user);

    if (strategies.length === 0) {
      this.logger.debug(`No active strategies for user ${user.id} (risk level ${user.coinRisk?.level})`);
      return;
    }

    // Get current composite regime for position sizing (reused for gate below)
    const compositeRegime = this.compositeRegimeService.getCompositeRegime();

    const capitalMap = await this.capitalAllocation.allocateCapitalByKelly(actualCapital, strategies, {
      compositeRegime,
      riskLevel: user.effectiveCalculationRiskLevel
    });

    const userPositions = await this.positionTracking.getPositions(user.id);

    const marketData = await this.opportunitySellingExecution.fetchMarketData();

    const overrideActive = this.compositeRegimeService.isOverrideActive();
    // Build asset allocations for concentration gate (reuse fetched balances)
    let assetAllocations = this.concentrationGate.buildAssetAllocations(balances.current);

    let gateBlockedCount = 0;
    let drawdownBlockedCount = 0;
    let dailyLossBlockedCount = 0;
    let concentrationBlockedCount = 0;
    let concentrationReducedCount = 0;

    // Daily loss limit gate: user-level check before strategy loop
    const dailyLossCheck = await this.dailyLossLimitGate.isEntryBlocked(
      user.id,
      actualCapital,
      user.effectiveCalculationRiskLevel
    );
    const dailyLossBlocked = dailyLossCheck.blocked;

    for (const strategy of strategies) {
      try {
        const allocatedCapital = capitalMap.get(strategy.id) || 0;
        const strategyPositions = userPositions.filter((p) => p.strategyConfigId === strategy.id);

        const signal = await this.strategyExecutor.executeStrategy(
          strategy,
          marketData,
          strategyPositions,
          allocatedCapital
        );

        if (signal && signal.action !== 'hold') {
          const action: Exclude<typeof signal.action, 'hold'> = signal.action as Exclude<typeof signal.action, 'hold'>;
          let placedReasonCode: SignalReasonCode | undefined;
          let placedReason: string | undefined;

          const validation = this.strategyExecutor.validateSignal(signal, allocatedCapital);
          if (!validation.valid) {
            this.logger.warn(`Invalid signal for user ${user.id}, strategy ${strategy.id}: ${validation.reason}`);
            await this.liveSignalService.recordFromTradingSignal(user.id, strategy.id, signal, SignalStatus.BLOCKED, {
              reasonCode: SignalReasonCode.SIGNAL_VALIDATION_FAILED,
              reason: validation.reason,
              metadata: { allocatedCapital }
            });
            continue;
          }

          // Skip BUY if long position already exists for this symbol
          if (action === 'buy') {
            const signalCoinId = extractCoinIdFromSymbol(signal.symbol);
            const existingPosition = strategyPositions.find(
              (p) =>
                p.positionSide !== 'short' &&
                Number(p.quantity) > 0 &&
                extractCoinIdFromSymbol(p.symbol) === signalCoinId
            );
            if (existingPosition) {
              this.logger.debug(
                `Skipped BUY for ${signal.symbol}: long position already held for strategy ${strategy.id}`
              );
              continue;
            }
          }

          // Daily loss limit gate: block BUY/short_entry when rolling 24h losses exceed threshold
          if (dailyLossBlocked && (action === 'buy' || action === 'short_entry')) {
            this.metricsService.recordDailyLossGateBlock();
            dailyLossBlockedCount++;
            await this.liveSignalService.recordFromTradingSignal(user.id, strategy.id, signal, SignalStatus.BLOCKED, {
              reasonCode: SignalReasonCode.DAILY_LOSS_LIMIT,
              reason: dailyLossCheck.reason,
              metadata: { allocatedCapital }
            });
            continue;
          }

          // Regime gate: context-aware policy via filter chain
          const gateResult = this.signalFilterChain.apply(
            [{ action, originalType: undefined }],
            {
              compositeRegime,
              riskLevel: user.effectiveCalculationRiskLevel,
              regimeGateEnabled: true,
              regimeScaledSizingEnabled: false,
              tradingContext: 'live',
              overrideActive
            },
            { maxAllocation: 1, minAllocation: 0 }
          );
          if (gateResult.signals.length === 0) {
            this.metricsService.recordRegimeGateBlock(compositeRegime);
            gateBlockedCount++;
            await this.liveSignalService.recordFromTradingSignal(user.id, strategy.id, signal, SignalStatus.BLOCKED, {
              reasonCode: SignalReasonCode.REGIME_GATE,
              reason: `Composite regime ${compositeRegime} blocked ${action.toUpperCase()} signal`,
              metadata: { compositeRegime, overrideActive }
            });
            continue;
          }

          // Drawdown gate: block BUY signals when deployment is in drawdown breach
          const drawdownCheck = await this.preTradeRiskGate.checkDrawdown(strategy.id, action);
          if (!drawdownCheck.allowed) {
            this.metricsService.recordDrawdownGateBlock();
            drawdownBlockedCount++;
            await this.liveSignalService.recordFromTradingSignal(user.id, strategy.id, signal, SignalStatus.BLOCKED, {
              reasonCode: SignalReasonCode.DRAWDOWN_GATE,
              reason: drawdownCheck.reason,
              metadata: { allocatedCapital }
            });
            continue;
          }

          // Concentration gate: block/reduce BUY/short_entry when single-asset concentration is too high
          if (action === 'buy' || action === 'short_entry') {
            const tradeUsdValue = signal.quantity * signal.price;
            const concCheck = this.concentrationGate.checkTrade(
              assetAllocations,
              signal.symbol,
              tradeUsdValue,
              user.effectiveCalculationRiskLevel,
              action
            );
            if (!concCheck.allowed) {
              this.metricsService.recordConcentrationGateBlock();
              concentrationBlockedCount++;
              await this.liveSignalService.recordFromTradingSignal(user.id, strategy.id, signal, SignalStatus.BLOCKED, {
                reasonCode: SignalReasonCode.CONCENTRATION_LIMIT,
                reason: concCheck.reason,
                metadata: { tradeUsdValue }
              });
              continue;
            }
            if (concCheck.adjustedQuantity != null && concCheck.adjustedQuantity < 1) {
              signal.quantity *= concCheck.adjustedQuantity;
              concentrationReducedCount++;
              placedReasonCode = SignalReasonCode.CONCENTRATION_REDUCED;
              placedReason = concCheck.reason;
            }
          }

          // Proactive opportunity selling: check if BUY needs capital freed up
          if ((action === 'buy' || action === 'short_entry') && user.enableOpportunitySelling) {
            const buyAmount = signal.quantity * signal.price;
            const availableCash = calculateFreeUsdValue(balances.current);

            if (buyAmount > availableCash) {
              const opportunitySellingResult = await this.opportunitySellingExecution.execute(
                user,
                signal,
                strategy.id,
                compositeRegime,
                userPositions,
                marketData,
                buyAmount,
                availableCash
              );
              if (!opportunitySellingResult.freed) {
                await this.liveSignalService.recordFromTradingSignal(
                  user.id,
                  strategy.id,
                  signal,
                  SignalStatus.BLOCKED,
                  {
                    reasonCode: SignalReasonCode.OPPORTUNITY_SELLING_REJECTED,
                    reason: opportunitySellingResult.reason ?? 'Opportunity selling did not free enough capital',
                    metadata: { availableCash, requiredBuyAmount: buyAmount }
                  }
                );
                continue;
              }

              // Re-verify available cash after opportunity sells (Fix #2)
              const updatedBalances = await this.balanceService.getUserBalances(user);
              const newAvailableCash = calculateFreeUsdValue(updatedBalances.current);
              if (newAvailableCash < buyAmount * 0.95) {
                const insufficientFundsReason =
                  `Insufficient funds after opportunity sells: needed $${buyAmount.toFixed(2)}, ` +
                  `available $${newAvailableCash.toFixed(2)} — skipping buy`;
                this.logger.warn(insufficientFundsReason);
                await this.liveSignalService.recordFromTradingSignal(
                  user.id,
                  strategy.id,
                  signal,
                  SignalStatus.BLOCKED,
                  {
                    reasonCode: SignalReasonCode.INSUFFICIENT_FUNDS,
                    reason: insufficientFundsReason,
                    metadata: { availableCash: newAvailableCash, requiredBuyAmount: buyAmount }
                  }
                );
                continue;
              }

              // Refresh balances so subsequent strategies see updated cash and concentrations
              balances = updatedBalances;
              assetAllocations = this.concentrationGate.buildAssetAllocations(balances.current);
            }
          }

          const orderResult = await this.orderPlacement.placeOrder(user, strategy.id, signal, strategy);
          if (orderResult.status === 'placed') {
            this.strategyExecutor.markExecuted(strategy.id, signal);
            await this.liveSignalService.recordFromTradingSignal(user.id, strategy.id, signal, SignalStatus.PLACED, {
              reasonCode: placedReasonCode,
              reason: placedReason,
              metadata: orderResult.metadata,
              orderId: orderResult.orderId
            });
          } else {
            await this.liveSignalService.recordFromTradingSignal(
              user.id,
              strategy.id,
              signal,
              orderResult.status === 'blocked' ? SignalStatus.BLOCKED : SignalStatus.FAILED,
              {
                reasonCode: orderResult.reasonCode,
                reason: orderResult.reason,
                metadata: orderResult.metadata
              }
            );
          }
        }
      } catch (error: unknown) {
        const err = toErrorInfo(error);
        this.logger.error(`Strategy ${strategy.id} execution failed for user ${user.id}: ${err.message}`);

        try {
          await this.failedJobService.recordFailure({
            queueName: 'live-trading-cron',
            jobId: `strategy:${strategy.id}:user:${user.id}`,
            jobName: 'executeStrategy',
            jobData: { userId: user.id, strategyId: strategy.id },
            errorMessage: err.message,
            stackTrace: err.stack
          });
        } catch {
          // fail-safe
        }
      }
    }

    if (gateBlockedCount > 0) {
      this.logger.log(
        `Regime gate blocked ${gateBlockedCount} signal(s) for user ${user.id} (regime=${compositeRegime})`
      );
    }

    if (drawdownBlockedCount > 0) {
      this.logger.log(`Drawdown gate blocked ${drawdownBlockedCount} BUY signal(s) for user ${user.id}`);
    }

    if (concentrationBlockedCount > 0) {
      this.logger.log(`Concentration gate blocked ${concentrationBlockedCount} entry signal(s) for user ${user.id}`);
    }

    if (concentrationReducedCount > 0) {
      this.logger.log(`Concentration gate reduced ${concentrationReducedCount} entry signal(s) for user ${user.id}`);
    }

    if (dailyLossBlockedCount > 0) {
      this.logger.log(
        `Daily loss limit gate blocked ${dailyLossBlockedCount} entry signal(s) for user ${user.id}: ${dailyLossCheck.reason}`
      );
    }
  }

  /**
   * Handle user execution errors with strike-based disabling.
   * Users get MAX_ERROR_STRIKES chances before algo trading is disabled.
   */
  private async handleUserError(user: User, error: unknown): Promise<void> {
    const err = toErrorInfo(error);
    const currentStrikes = (this.userErrorStrikes.get(user.id) || 0) + 1;
    this.userErrorStrikes.set(user.id, currentStrikes);

    if (currentStrikes >= MAX_ERROR_STRIKES) {
      this.logger.error(
        `Disabling algo trading for user ${user.id} after ${currentStrikes} consecutive errors: ${err.message}`
      );

      try {
        user.algoTradingEnabled = false;
        await this.userRepo.save(user);
        this.userErrorStrikes.delete(user.id);
      } catch (saveError: unknown) {
        const innerErr = toErrorInfo(saveError);
        this.logger.error(`Failed to disable algo trading for user ${user.id}: ${innerErr.message}`);
      }
    } else {
      this.logger.warn(
        `User ${user.id} error strike ${currentStrikes}/${MAX_ERROR_STRIKES}: ${err.message}. ` +
          `Algo trading will be disabled after ${MAX_ERROR_STRIKES - currentStrikes} more errors.`
      );
    }
  }

  async getStatus(): Promise<{ running: boolean; enrolledUsers: number; instanceId?: string }> {
    const [lockInfo, enrolledCount] = await Promise.all([
      this.lockService.getLockInfo(LOCK_KEYS.LIVE_TRADING),
      this.userRepo.count({ where: { algoTradingEnabled: true } })
    ]);

    return {
      running: lockInfo.exists,
      enrolledUsers: enrolledCount,
      instanceId: lockInfo.lockId ?? undefined
    };
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    if (this.currentLockToken) {
      this.logger.log(`Releasing live trading lock on shutdown (signal: ${signal})`);
      await this.lockService.release(LOCK_KEYS.LIVE_TRADING, this.currentLockToken);
      this.currentLockToken = null;
    }
  }
}
