import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { Decimal } from 'decimal.js';

import { IndicatorService } from '../../algorithm/indicators/indicator.service';
import { PriceSummary } from '../../ohlc/ohlc-candle.entity';
import { toErrorInfo } from '../../shared/error.util';
import {
  calculateStopLossPrice as computeSL,
  calculateTakeProfitPrice as computeTP,
  calculateTrailingActivationPrice as computeTrailingActivation,
  calculateTrailingStopPrice as computeTrailingStop
} from '../backtest/shared/exits/exit-price.utils';
import {
  CalculatedExitPrices,
  ExchangeMarketLimits,
  ExitConfig,
  ExitPriceValidationError,
  ExitPriceValidationErrorCode,
  ExitPriceValidationLimits,
  ExitPriceValidationResult,
  DEFAULT_EXIT_PRICE_VALIDATION_LIMITS,
  QuantityValidationResult,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';

/**
 * ExitPriceService
 *
 * Handles all exit price calculation, validation, config input sanitization,
 * ATR computation, and quantity validation for exit orders.
 */
@Injectable()
export class ExitPriceService {
  private readonly logger = new Logger(ExitPriceService.name);

  constructor(private readonly indicatorService: IndicatorService) {}

  /**
   * Calculate exit prices based on entry and configuration
   */
  calculateExitPrices(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): CalculatedExitPrices {
    const result: CalculatedExitPrices = { entryPrice };

    // Calculate stop loss price
    if (config.enableStopLoss) {
      result.stopLossPrice = this.calculateStopLossPrice(entryPrice, side, config, currentAtr);
    }

    // Calculate take profit price
    if (config.enableTakeProfit) {
      result.takeProfitPrice = this.calculateTakeProfitPrice(entryPrice, side, config, result.stopLossPrice);
    }

    // Calculate trailing stop initial price
    if (config.enableTrailingStop) {
      result.trailingStopPrice = this.calculateTrailingStopPrice(entryPrice, side, config, currentAtr);

      // Calculate activation price if not immediate
      if (config.trailingActivation !== TrailingActivationType.IMMEDIATE) {
        result.trailingActivationPrice = this.calculateTrailingActivationPrice(entryPrice, side, config);
      }
    }

    return result;
  }

  /**
   * Validate calculated exit prices for sanity (price manipulation protection)
   *
   * Checks:
   * - Prices are on correct side of entry (SL below for long, above for short, etc.)
   * - Prices are within reasonable distance from entry (not >50% for SL, etc.)
   * - Prices are not too close to entry (not <0.1%, likely an error)
   * - Prices are positive and non-zero
   */
  validateExitPrices(
    calculatedPrices: CalculatedExitPrices,
    side: 'BUY' | 'SELL',
    limits: ExitPriceValidationLimits = DEFAULT_EXIT_PRICE_VALIDATION_LIMITS
  ): ExitPriceValidationResult {
    const errors: ExitPriceValidationError[] = [];
    const { entryPrice, stopLossPrice, takeProfitPrice, trailingStopPrice } = calculatedPrices;

    // Validate stop loss
    if (stopLossPrice !== undefined) {
      const slErrors = this.validateSingleExitPrice(
        'stopLoss',
        stopLossPrice,
        entryPrice,
        side,
        limits.minStopLossPercentage,
        limits.maxStopLossPercentage,
        side === 'BUY' ? 'below' : 'above'
      );
      errors.push(...slErrors);
    }

    // Validate take profit
    if (takeProfitPrice !== undefined) {
      const tpErrors = this.validateSingleExitPrice(
        'takeProfit',
        takeProfitPrice,
        entryPrice,
        side,
        limits.minTakeProfitPercentage,
        limits.maxTakeProfitPercentage,
        side === 'BUY' ? 'above' : 'below'
      );
      errors.push(...tpErrors);
    }

    // Validate trailing stop
    if (trailingStopPrice !== undefined) {
      const tsErrors = this.validateSingleExitPrice(
        'trailingStop',
        trailingStopPrice,
        entryPrice,
        side,
        limits.minTrailingStopPercentage,
        limits.maxTrailingStopPercentage,
        side === 'BUY' ? 'below' : 'above'
      );
      errors.push(...tsErrors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate and adjust exit order quantity against exchange requirements
   *
   * Checks:
   * - Quantity is above minimum order size
   * - Quantity meets minimum notional value (quantity × price)
   * - Quantity is aligned to step size precision
   */
  validateExitOrderQuantity(
    quantity: number,
    price: number,
    limits: ExchangeMarketLimits | null
  ): QuantityValidationResult {
    // If no limits available, accept the quantity as-is
    if (!limits) {
      const actualNotional = new Decimal(quantity).times(price).toNumber();
      return {
        isValid: true,
        originalQuantity: quantity,
        adjustedQuantity: quantity,
        minQuantity: 0,
        minNotional: 0,
        actualNotional
      };
    }

    const { minAmount, amountStep, minCost, amountPrecision } = limits;

    // amountStep and amountPrecision are pre-normalized by getMarketLimits()
    const step = new Decimal(amountStep);
    const qDec = new Decimal(quantity);
    const adjustedQuantity = step.gt(0)
      ? qDec.div(step).floor().times(step).toDecimalPlaces(amountPrecision).toNumber()
      : qDec.toDecimalPlaces(amountPrecision).toNumber();

    // Calculate notional value
    const priceDec = new Decimal(price);
    const actualNotional = new Decimal(adjustedQuantity).times(priceDec).toNumber();

    // Check minimum quantity
    if (adjustedQuantity < minAmount) {
      return {
        isValid: false,
        originalQuantity: quantity,
        adjustedQuantity,
        minQuantity: minAmount,
        minNotional: minCost,
        actualNotional,
        error: `Quantity ${adjustedQuantity} is below minimum ${minAmount} for this market`
      };
    }

    // Check minimum notional value
    if (actualNotional < minCost && minCost > 0) {
      const requiredQuantity = step.gt(0)
        ? new Decimal(minCost).div(priceDec).div(step).ceil().times(step).toNumber()
        : new Decimal(minCost).div(priceDec).ceil().toNumber();
      return {
        isValid: false,
        originalQuantity: quantity,
        adjustedQuantity,
        minQuantity: minAmount,
        minNotional: minCost,
        actualNotional,
        error: `Order value ${actualNotional.toFixed(2)} is below minimum ${minCost}. Need at least ${requiredQuantity} units.`
      };
    }

    return {
      isValid: true,
      originalQuantity: quantity,
      adjustedQuantity,
      minQuantity: minAmount,
      minNotional: minCost,
      actualNotional
    };
  }

  /**
   * Validate exit config input values for sanity (defense-in-depth)
   *
   * Checks all numeric config values are:
   * - Finite (not NaN or Infinity)
   * - Non-negative
   * - Within reasonable bounds for their type
   *
   * This validation runs BEFORE price calculation to catch malformed inputs early.
   *
   * @throws BadRequestException if any input value is invalid
   */
  validateExitConfigInputs(config: ExitConfig): void {
    const errors: string[] = [];

    // Helper to validate a numeric value
    const validateNumeric = (value: number | undefined, fieldName: string, maxValue?: number): void => {
      if (value === undefined) return;

      if (!Number.isFinite(value)) {
        errors.push(`${fieldName} must be a finite number (got ${value})`);
        return;
      }

      if (value < 0) {
        errors.push(`${fieldName} must be non-negative (got ${value})`);
      }

      if (maxValue !== undefined && value > maxValue) {
        errors.push(`${fieldName} exceeds maximum allowed value of ${maxValue} (got ${value})`);
      }
    };

    // Validate stop loss inputs
    if (config.enableStopLoss) {
      if (config.stopLossType === StopLossType.FIXED) {
        validateNumeric(config.stopLossValue, 'stopLossValue', 10_000_000);
      } else if (config.stopLossType === StopLossType.PERCENTAGE) {
        validateNumeric(config.stopLossValue, 'stopLossValue', 100);
      } else if (config.stopLossType === StopLossType.ATR) {
        validateNumeric(config.stopLossValue, 'stopLossValue', 10);
      }
    }

    // Validate take profit inputs
    if (config.enableTakeProfit) {
      if (config.takeProfitType === TakeProfitType.FIXED) {
        validateNumeric(config.takeProfitValue, 'takeProfitValue', 100_000_000);
      } else if (config.takeProfitType === TakeProfitType.PERCENTAGE) {
        validateNumeric(config.takeProfitValue, 'takeProfitValue', 1000);
      } else if (config.takeProfitType === TakeProfitType.RISK_REWARD) {
        validateNumeric(config.takeProfitValue, 'takeProfitValue', 100);
      }
    }

    // Validate trailing stop inputs
    if (config.enableTrailingStop) {
      if (config.trailingType === TrailingType.AMOUNT) {
        validateNumeric(config.trailingValue, 'trailingValue', 10_000_000);
      } else if (config.trailingType === TrailingType.PERCENTAGE) {
        validateNumeric(config.trailingValue, 'trailingValue', 100);
      } else if (config.trailingType === TrailingType.ATR) {
        validateNumeric(config.trailingValue, 'trailingValue', 10);
      }

      // Validate activation value if not immediate
      if (config.trailingActivation === TrailingActivationType.PRICE) {
        validateNumeric(config.trailingActivationValue, 'trailingActivationValue', 100_000_000);
      } else if (config.trailingActivation === TrailingActivationType.PERCENTAGE) {
        validateNumeric(config.trailingActivationValue, 'trailingActivationValue', 1000);
      }
    }

    // Validate ATR settings
    validateNumeric(config.atrPeriod, 'atrPeriod', 200);
    validateNumeric(config.atrMultiplier, 'atrMultiplier', 10);

    if (errors.length > 0) {
      throw new BadRequestException(`Invalid exit config values: ${errors.join('; ')}`);
    }
  }

  /**
   * Calculate current ATR value from price data
   */
  async calculateCurrentAtr(coinId: string, priceData: PriceSummary[], period: number): Promise<number | undefined> {
    try {
      if (priceData.length < period + 1) {
        this.logger.warn(`Insufficient price data for ATR calculation: ${priceData.length} < ${period + 1}`);
        return undefined;
      }

      const atrResult = await this.indicatorService.calculateATR({
        coinId,
        prices: priceData,
        period
      });

      // Get the most recent non-NaN ATR value
      for (let i = atrResult.values.length - 1; i >= 0; i--) {
        if (!isNaN(atrResult.values[i])) {
          return atrResult.values[i];
        }
      }

      return undefined;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`ATR calculation failed: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Validate a single exit price
   */
  private validateSingleExitPrice(
    exitType: 'stopLoss' | 'takeProfit' | 'trailingStop',
    price: number,
    entryPrice: number,
    side: 'BUY' | 'SELL',
    minPercentage: number,
    maxPercentage: number,
    expectedSide: 'above' | 'below'
  ): ExitPriceValidationError[] {
    const errors: ExitPriceValidationError[] = [];
    const distancePercentage = new Decimal(price).minus(entryPrice).abs().div(entryPrice).times(100).toNumber();

    // Check for invalid price (zero or negative)
    if (price <= 0) {
      errors.push({
        exitType,
        code: ExitPriceValidationErrorCode.INVALID_PRICE,
        message: `${exitType} price must be positive (got ${price})`,
        calculatedPrice: price,
        entryPrice,
        distancePercentage: 0
      });
      return errors;
    }

    // Check price is on correct side
    const isAbove = price > entryPrice;
    const isBelow = price < entryPrice;
    const isOnCorrectSide = expectedSide === 'above' ? isAbove : isBelow;

    if (!isOnCorrectSide && price !== entryPrice) {
      const sideDescription = side === 'BUY' ? 'long' : 'short';
      const expectedDescription = expectedSide === 'above' ? 'above' : 'below';
      errors.push({
        exitType,
        code: ExitPriceValidationErrorCode.WRONG_SIDE,
        message: `${exitType} price (${price}) must be ${expectedDescription} entry price (${entryPrice}) for ${sideDescription} position`,
        calculatedPrice: price,
        entryPrice,
        distancePercentage
      });
    }

    // Check minimum distance (too close suggests an error)
    if (distancePercentage < minPercentage && price !== entryPrice) {
      errors.push({
        exitType,
        code: ExitPriceValidationErrorCode.BELOW_MIN_DISTANCE,
        message: `${exitType} is only ${distancePercentage.toFixed(2)}% from entry, minimum is ${minPercentage}%`,
        calculatedPrice: price,
        entryPrice,
        distancePercentage
      });
    }

    // Check maximum distance (too far suggests manipulation or error)
    if (distancePercentage > maxPercentage) {
      errors.push({
        exitType,
        code: ExitPriceValidationErrorCode.EXCEEDS_MAX_DISTANCE,
        message: `${exitType} is ${distancePercentage.toFixed(2)}% from entry, maximum allowed is ${maxPercentage}%`,
        calculatedPrice: price,
        entryPrice,
        distancePercentage
      });
    }

    return errors;
  }

  /**
   * Calculate stop loss price — delegates to shared pure utility.
   */
  private calculateStopLossPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): number {
    if (config.stopLossType === StopLossType.ATR && (!currentAtr || isNaN(currentAtr))) {
      this.logger.warn(
        {
          event: 'exit_price.atr_fallback',
          exitType: 'stop_loss',
          entryPrice,
          side,
          stopLossValue: config.stopLossValue,
          fallbackPercent: 2
        },
        'ATR unavailable for stop loss — falling back to 2% (data-quality issue)'
      );
    }
    return computeSL(entryPrice, side, config, currentAtr);
  }

  /**
   * Calculate take profit price — delegates to shared pure utility.
   */
  private calculateTakeProfitPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    stopLossPrice?: number
  ): number {
    if (config.takeProfitType === TakeProfitType.RISK_REWARD && !stopLossPrice) {
      this.logger.warn(
        {
          event: 'exit_price.atr_fallback',
          exitType: 'take_profit',
          entryPrice,
          side,
          takeProfitValue: config.takeProfitValue,
          fallbackPercent: 4
        },
        'Stop loss unavailable for R:R take profit — falling back to 4% (data-quality issue)'
      );
    }
    return computeTP(entryPrice, side, config, stopLossPrice);
  }

  /**
   * Calculate initial trailing stop price — delegates to shared pure utility.
   */
  private calculateTrailingStopPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): number {
    if (config.trailingType === TrailingType.ATR && (!currentAtr || isNaN(currentAtr))) {
      this.logger.warn(
        {
          event: 'exit_price.atr_fallback',
          exitType: 'trailing_stop',
          entryPrice,
          side,
          trailingValue: config.trailingValue,
          fallbackPercent: 1
        },
        'ATR unavailable for trailing stop — falling back to 1% (data-quality issue)'
      );
    }
    return computeTrailingStop(entryPrice, side, config, currentAtr);
  }

  /**
   * Calculate trailing stop activation price — delegates to shared pure utility.
   */
  private calculateTrailingActivationPrice(entryPrice: number, side: 'BUY' | 'SELL', config: ExitConfig): number {
    return computeTrailingActivation(entryPrice, side, config);
  }
}
