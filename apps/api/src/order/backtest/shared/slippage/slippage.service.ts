import { Injectable } from '@nestjs/common';

import {
  DEFAULT_SLIPPAGE_CONFIG,
  FillAssessment,
  ISlippageService,
  SlippageConfig,
  SlippageInput,
  SlippageModelType,
  SlippageResult
} from './slippage.interface';

/**
 * Slippage Service
 *
 * Provides configurable slippage simulation for backtesting.
 * Wraps existing slippage calculation functions in an injectable service
 * for consistent usage across all BacktestTypes.
 *
 * @example
 * ```typescript
 * const result = slippageService.calculateSlippage({
 *   price: 50000,
 *   quantity: 0.5,
 *   isBuy: true,
 *   dailyVolume: 1000000
 * });
 * // result.executionPrice = 50025 (with 5 bps slippage)
 * ```
 */
@Injectable()
export class SlippageService implements ISlippageService {
  /**
   * Calculate slippage and execution price for an order
   * @throws Error if price is not a positive finite number
   */
  calculateSlippage(input: SlippageInput, config: SlippageConfig = DEFAULT_SLIPPAGE_CONFIG): SlippageResult {
    if (!Number.isFinite(input.price) || input.price <= 0) {
      throw new Error('Price must be a positive finite number');
    }

    const effectiveConfig = this.buildConfig(config);
    const slippageBps = this.calculateSlippageBps(input.quantity, input.price, effectiveConfig, input.dailyVolume);
    const executionPrice = this.applySlippage(input.price, slippageBps, input.isBuy);
    const priceImpact = Math.abs(executionPrice - input.price) / input.price;

    return {
      slippageBps,
      executionPrice,
      priceImpact,
      originalPrice: input.price
    };
  }

  /**
   * Calculate slippage in basis points based on model configuration
   */
  calculateSlippageBps(
    quantity: number,
    price: number,
    config: SlippageConfig = DEFAULT_SLIPPAGE_CONFIG,
    dailyVolume?: number
  ): number {
    const effectiveConfig = this.buildConfig(config);
    const maxSlippage = effectiveConfig.maxSlippageBps ?? 500;

    let slippageBps: number;

    switch (effectiveConfig.type) {
      case SlippageModelType.NONE:
        slippageBps = 0;
        break;

      case SlippageModelType.FIXED:
        slippageBps = effectiveConfig.fixedBps ?? 5;
        break;

      case SlippageModelType.VOLUME_BASED: {
        const orderValue = quantity * price;
        const baseSlippage = effectiveConfig.baseSlippageBps ?? 5;
        if (!dailyVolume || dailyVolume <= 0) {
          slippageBps = baseSlippage;
          break;
        }
        const participationRate = orderValue / dailyVolume;
        const sigma = effectiveConfig.volatilityFactor ?? 0.1;
        // Almgren-Chriss square-root temporary impact: impact ∝ σ * √(Q/V)
        const impactDecimal = sigma * Math.sqrt(participationRate);
        slippageBps = baseSlippage + impactDecimal * 10000;
        break;
      }

      case SlippageModelType.HISTORICAL:
        // Placeholder for historical slippage data integration
        // Would use actual historical slippage from similar orders
        // Use original config.fixedBps (not effectiveConfig) to preserve 10 bps default for HISTORICAL
        slippageBps = config?.fixedBps ?? 10;
        break;

      default:
        slippageBps = 5;
    }

    // Apply maximum slippage cap
    return Math.min(slippageBps, maxSlippage);
  }

  /**
   * Apply slippage to execution price
   * Buy orders pay more (price increases), sell orders receive less (price decreases)
   */
  applySlippage(price: number, slippageBps: number, isBuy: boolean): number {
    const slippageFactor = slippageBps / 10000;
    return isBuy ? price * (1 + slippageFactor) : price * (1 - slippageFactor);
  }

  /**
   * Assess whether an order can be filled given daily volume constraints.
   * Only applies participation limits for VOLUME_BASED model with defined volume.
   */
  assessFillability(
    orderValue: number,
    price: number,
    dailyVolume: number | undefined,
    config: SlippageConfig = DEFAULT_SLIPPAGE_CONFIG
  ): FillAssessment {
    const effectiveConfig = this.buildConfig(config);
    const orderQuantity = price > 0 ? orderValue / price : 0;

    // Non-VOLUME_BASED models or missing volume: always full fill
    if (effectiveConfig.type !== SlippageModelType.VOLUME_BASED || !dailyVolume || dailyVolume <= 0) {
      return { fillable: true, fillableQuantity: orderQuantity, fillStatus: 'FILLED', participationRate: 0 };
    }

    const rawParticipationRate = orderValue / dailyVolume;

    // Check rejection threshold first
    if (
      effectiveConfig.rejectParticipationRate != null &&
      rawParticipationRate >= effectiveConfig.rejectParticipationRate
    ) {
      return {
        fillable: false,
        fillableQuantity: 0,
        fillStatus: 'CANCELLED',
        participationRate: rawParticipationRate,
        reason: `Order participation rate ${(rawParticipationRate * 100).toFixed(1)}% exceeds rejection threshold ${(effectiveConfig.rejectParticipationRate * 100).toFixed(1)}%`
      };
    }

    // Check participation rate limit for partial fill
    if (
      effectiveConfig.participationRateLimit != null &&
      rawParticipationRate > effectiveConfig.participationRateLimit
    ) {
      const fillableQuantity = (effectiveConfig.participationRateLimit * dailyVolume) / price;
      return {
        fillable: true,
        fillableQuantity,
        fillStatus: 'PARTIAL',
        participationRate: rawParticipationRate,
        reason: `Order capped to ${(effectiveConfig.participationRateLimit * 100).toFixed(1)}% participation rate`
      };
    }

    return {
      fillable: true,
      fillableQuantity: orderQuantity,
      fillStatus: 'FILLED',
      participationRate: rawParticipationRate
    };
  }

  /**
   * Build complete configuration from partial inputs with defaults
   */
  buildConfig(config?: Partial<SlippageConfig>): SlippageConfig {
    return {
      type: config?.type ?? SlippageModelType.FIXED,
      fixedBps: config?.fixedBps ?? 5,
      baseSlippageBps: config?.baseSlippageBps ?? 5,
      maxSlippageBps: config?.maxSlippageBps ?? 500,
      participationRateLimit: config?.participationRateLimit,
      rejectParticipationRate: config?.rejectParticipationRate,
      volatilityFactor: config?.volatilityFactor ?? 0.1
    };
  }
}
