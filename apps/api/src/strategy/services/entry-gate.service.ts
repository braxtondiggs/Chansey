import { Injectable, Logger } from '@nestjs/common';

import { SignalReasonCode } from '@chansey/api-interfaces';

import { MetricsService } from '../../metrics/metrics.service';
import { TradeCooldownService } from '../../shared/trade-cooldown.service';
import { ConcentrationGateService } from '../concentration-gate.service';
import { DailyLossLimitGateService } from '../daily-loss-limit-gate.service';
import { AssetAllocation } from '../risk/concentration-check.service';

export interface EntryGateContext {
  userId: string;
  symbol: string;
  action: 'BUY' | 'SELL';
  positionSide?: 'long' | 'short';
  portfolioValue: number;
  allocationPercentage: number;
  riskLevel: number;
  assets: AssetAllocation[];
  isDailyLossBlocked: boolean;
  pipelineId: string;
}

export interface EntryGateResult {
  allowed: boolean;
  reasonCode?: SignalReasonCode;
  reason?: string;
  metadata?: Record<string, unknown>;
  adjustedQuantity?: number;
  cooldownClaim?: { pipeline?: string };
}

/**
 * Unified entry gate sequence: daily-loss → concentration → cooldown.
 * Used by both Pipeline 1 (LiveTradingService) and Pipeline 2 (TradeExecutionTask).
 */
@Injectable()
export class EntryGateService {
  private readonly logger = new Logger(EntryGateService.name);

  constructor(
    private readonly dailyLossLimitGate: DailyLossLimitGateService,
    private readonly concentrationGate: ConcentrationGateService,
    private readonly tradeCooldownService: TradeCooldownService,
    private readonly metricsService: MetricsService
  ) {}

  /**
   * Run the full entry gate sequence. Returns immediately on first rejection.
   * Exit signals (SELL for long, BUY for short) bypass daily-loss and concentration gates.
   */
  async checkEntryGates(ctx: EntryGateContext): Promise<EntryGateResult> {
    const isEntry =
      (ctx.action === 'BUY' && ctx.positionSide !== 'short') || (ctx.action === 'SELL' && ctx.positionSide === 'short');

    if (isEntry) {
      // Gate 1: Daily loss limit
      if (ctx.isDailyLossBlocked) {
        this.metricsService.recordDailyLossGateBlock();
        return {
          allowed: false,
          reasonCode: SignalReasonCode.DAILY_LOSS_LIMIT,
          reason: `Daily loss limit blocked ${ctx.action} ${ctx.symbol}`,
          metadata: { portfolioValue: ctx.portfolioValue }
        };
      }

      // Gate 1.5: Existing holding — skip BUY if user already holds this asset
      if (ctx.action === 'BUY') {
        const [baseCurrency] = ctx.symbol.split('/');
        const existingHolding = ctx.assets.find(
          (a) => a.symbol.toUpperCase() === baseCurrency.toUpperCase() && a.usdValue > 1.0
        );
        if (existingHolding) {
          return {
            allowed: false,
            reasonCode: SignalReasonCode.EXISTING_HOLDING,
            reason: `User already holds ${baseCurrency}`,
            metadata: { existingUsdValue: existingHolding.usdValue }
          };
        }
      }

      // Gate 2: Concentration limit
      const estimatedTradeUsd = ctx.portfolioValue * (ctx.allocationPercentage / 100);
      const concCheck = this.concentrationGate.checkTrade(
        ctx.assets,
        ctx.symbol,
        estimatedTradeUsd,
        ctx.riskLevel,
        ctx.action
      );
      if (!concCheck.allowed) {
        this.metricsService.recordConcentrationGateBlock();
        return {
          allowed: false,
          reasonCode: SignalReasonCode.CONCENTRATION_LIMIT,
          reason: concCheck.reason,
          metadata: { estimatedTradeUsd }
        };
      }

      // Concentration gate allows with reduced size — still need cooldown check
      if (concCheck.adjustedQuantity != null && concCheck.adjustedQuantity < 1) {
        const cooldownResult = await this.checkCooldown(ctx);
        if (!cooldownResult.allowed) return cooldownResult;
        return { ...cooldownResult, allowed: true, adjustedQuantity: concCheck.adjustedQuantity };
      }
    }

    // Gate 3: Trade cooldown
    return this.checkCooldown(ctx);
  }

  async clearCooldownOnFailure(userId: string, symbol: string, action: string): Promise<void> {
    await this.tradeCooldownService.clearCooldown(userId, symbol, action);
  }

  private async checkCooldown(ctx: EntryGateContext): Promise<EntryGateResult> {
    const cooldownCheck = await this.tradeCooldownService.checkAndClaim(
      ctx.userId,
      ctx.symbol,
      ctx.action,
      ctx.pipelineId
    );

    if (!cooldownCheck.allowed) {
      this.logger.warn(
        `Trade cooldown blocked ${ctx.action} ${ctx.symbol} for user ${ctx.userId} — ` +
          `already claimed by ${cooldownCheck.existingClaim?.pipeline}`
      );
      return {
        allowed: false,
        reasonCode: SignalReasonCode.TRADE_COOLDOWN,
        reason:
          `Trade cooldown blocked ${ctx.action} ${ctx.symbol} ` +
          `already claimed by ${cooldownCheck.existingClaim?.pipeline}`,
        metadata: { existingClaim: cooldownCheck.existingClaim?.pipeline },
        cooldownClaim: cooldownCheck.existingClaim
      };
    }

    return { allowed: true };
  }
}
