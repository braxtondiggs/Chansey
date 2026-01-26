import { Injectable } from '@nestjs/common';

import {
  DEFAULT_FEE_CONFIG,
  FeeConfig,
  FeeInput,
  FeeResult,
  FeeType,
  IFeeCalculator
} from './fee-calculator.interface';

/**
 * Fee Calculator Service
 *
 * Provides fee calculation for backtesting with support for multiple fee structures:
 * - FLAT: Single rate for all trades (default)
 * - MAKER_TAKER: Different rates for maker vs taker orders
 *
 * Note: This service calculates fees but does NOT deduct them from balances.
 * The calling code is responsible for deducting fees exactly once from the
 * appropriate balance (typically cashBalance).
 *
 * @example
 * ```typescript
 * // Calculate fee for a $10,000 trade
 * const result = feeCalculator.calculateFee({ tradeValue: 10000 });
 * // result.fee = 10 (with 0.1% default rate)
 *
 * // Deduct fee from cash balance (do this ONCE)
 * portfolio.cashBalance -= result.fee;
 * ```
 */
@Injectable()
export class FeeCalculatorService implements IFeeCalculator {
  /**
   * Calculate fee for a trade
   * @throws Error if tradeValue is negative
   */
  calculateFee(input: FeeInput, config: FeeConfig = DEFAULT_FEE_CONFIG): FeeResult {
    if (input.tradeValue < 0) {
      throw new Error('Trade value cannot be negative');
    }

    const effectiveConfig = this.buildConfig(config);
    const rate = this.getRate(effectiveConfig, input.isMaker);
    const fee = input.tradeValue * rate;

    const result: FeeResult = {
      fee,
      rate
    };

    if (effectiveConfig.type === FeeType.MAKER_TAKER) {
      result.orderType = input.isMaker ? 'maker' : 'taker';
    }

    return result;
  }

  /**
   * Get the applicable fee rate based on configuration and order type
   */
  getRate(config: FeeConfig, isMaker?: boolean): number {
    const effectiveConfig = this.buildConfig(config);

    switch (effectiveConfig.type) {
      case FeeType.FLAT:
        return effectiveConfig.flatRate ?? 0.001;

      case FeeType.MAKER_TAKER:
        if (isMaker) {
          return effectiveConfig.makerRate ?? 0.0005;
        }
        return effectiveConfig.takerRate ?? 0.001;

      default:
        return 0.001;
    }
  }

  /**
   * Build complete fee configuration from partial input with defaults
   */
  buildConfig(config?: Partial<FeeConfig>): FeeConfig {
    const type = config?.type ?? FeeType.FLAT;

    return {
      type,
      flatRate: config?.flatRate ?? 0.001,
      makerRate: config?.makerRate ?? 0.0005,
      takerRate: config?.takerRate ?? 0.001
    };
  }

  /**
   * Create FeeConfig from a simple flat rate
   * Convenience method for backward compatibility with existing backtest code
   * @throws Error if rate is not a non-negative finite number
   */
  fromFlatRate(rate: number): FeeConfig {
    if (!Number.isFinite(rate) || rate < 0) {
      throw new Error('Fee rate must be a non-negative finite number');
    }

    return {
      type: FeeType.FLAT,
      flatRate: rate
    };
  }
}
