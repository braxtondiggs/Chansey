import { Injectable } from '@nestjs/common';

import {
  DEFAULT_SLIPPAGE_CONFIG,
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
        // Slippage increases with order size relative to daily volume
        const orderValue = quantity * price;
        const volumeRatio = dailyVolume && dailyVolume > 0 ? orderValue / dailyVolume : 0.001;
        const baseSlippage = effectiveConfig.baseSlippageBps ?? 5;
        const volumeImpact = effectiveConfig.volumeImpactFactor ?? 100;
        slippageBps = baseSlippage + volumeRatio * volumeImpact;
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
   * Build complete configuration from partial inputs with defaults
   */
  buildConfig(config?: Partial<SlippageConfig>): SlippageConfig {
    return {
      type: config?.type ?? SlippageModelType.FIXED,
      fixedBps: config?.fixedBps ?? 5,
      baseSlippageBps: config?.baseSlippageBps ?? 5,
      volumeImpactFactor: config?.volumeImpactFactor ?? 100,
      maxSlippageBps: config?.maxSlippageBps ?? 500
    };
  }
}
