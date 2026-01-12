import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import * as ccxt from 'ccxt';
import { DataSource, QueryRunner, Repository } from 'typeorm';

import { randomUUID } from 'crypto';

import { IndicatorService } from '../../algorithm/indicators/indicator.service';
import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { ExchangeKey } from '../../exchange/exchange-key/exchange-key.entity';
import { ExchangeKeyService } from '../../exchange/exchange-key/exchange-key.service';
import { ExchangeManagerService } from '../../exchange/exchange-manager.service';
import { PriceSummary } from '../../price/price.entity';
import { CircuitBreakerService, CircuitOpenError } from '../../shared/circuit-breaker.service';
import { isTransientError, withRetry } from '../../shared/retry.util';
import { User } from '../../users/users.entity';
import { PositionExit } from '../entities/position-exit.entity';
import {
  AttachExitOrdersResult,
  CalculatedExitPrices,
  DEFAULT_EXIT_CONFIG,
  DEFAULT_EXIT_PRICE_VALIDATION_LIMITS,
  ExchangeMarketLimits,
  ExitConfig,
  ExitPriceValidationError,
  ExitPriceValidationErrorCode,
  ExitPriceValidationLimits,
  ExitPriceValidationResult,
  PlaceExitOrderParams,
  PositionExitStatus,
  QuantityValidationResult,
  StopLossType,
  TakeProfitType,
  TrailingActivationType,
  TrailingType
} from '../interfaces/exit-config.interface';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

/**
 * Exchange OCO support configuration
 */
interface ExchangeOcoSupport {
  /** Exchange supports native OCO orders */
  native: boolean;
  /** Exchange supports simulated OCO (via position monitoring) */
  simulated: boolean;
}

/**
 * PositionManagementService
 *
 * Manages automated exit orders (stop-loss, take-profit, trailing stop) for positions.
 * Attaches exit orders to entry orders, calculates exit prices, and handles OCO linking.
 */
@Injectable()
export class PositionManagementService {
  private readonly logger = new Logger(PositionManagementService.name);

  /**
   * Known OCO support per exchange
   */
  private readonly exchangeOcoSupport: Record<string, ExchangeOcoSupport> = {
    binance_us: { native: true, simulated: true },
    binance: { native: true, simulated: true },
    coinbase: { native: false, simulated: true },
    gdax: { native: false, simulated: true },
    kraken: { native: false, simulated: true }
  };

  constructor(
    @InjectRepository(PositionExit)
    private readonly positionExitRepo: Repository<PositionExit>,
    @InjectRepository(Order)
    private readonly orderRepo: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeManagerService: ExchangeManagerService,
    private readonly coinService: CoinService,
    private readonly indicatorService: IndicatorService,
    private readonly dataSource: DataSource,
    private readonly circuitBreaker: CircuitBreakerService
  ) {}

  /**
   * Execute an exchange operation with circuit breaker and retry protection
   *
   * @param exchangeSlug - Exchange identifier for circuit breaker tracking
   * @param operation - Async operation to execute
   * @param operationName - Name for logging
   * @returns Operation result
   * @throws CircuitOpenError if circuit is open
   * @throws Original error if all retries fail
   */
  private async executeWithResilience<T>(
    exchangeSlug: string,
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    const circuitKey = `exchange:${exchangeSlug}`;

    // Check circuit breaker first (fail-fast)
    try {
      this.circuitBreaker.checkCircuit(circuitKey);
    } catch (error) {
      if (error instanceof CircuitOpenError) {
        this.logger.warn(`${operationName} blocked by circuit breaker for ${exchangeSlug}: ${error.message}`);
      }
      throw error;
    }

    // Execute with retry
    const result = await withRetry(operation, {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      isRetryable: isTransientError,
      logger: this.logger,
      operationName: `${operationName} (${exchangeSlug})`
    });

    if (result.success) {
      this.circuitBreaker.recordSuccess(circuitKey);
      return result.result as T;
    }

    // Record failure and throw
    this.circuitBreaker.recordFailure(circuitKey);
    throw result.error;
  }

  /**
   * Attach exit orders to a newly created entry order
   *
   * @param entryOrder - The entry order to attach exits to
   * @param exitConfig - Exit configuration (SL/TP/trailing settings)
   * @param priceData - Historical price data for ATR calculation (optional)
   * @returns Result with exit order IDs and calculated prices
   */
  async attachExitOrders(
    entryOrder: Order,
    exitConfig: Partial<ExitConfig>,
    priceData?: PriceSummary[]
  ): Promise<AttachExitOrdersResult> {
    const config = { ...DEFAULT_EXIT_CONFIG, ...exitConfig };
    const warnings: string[] = [];

    this.logger.log(`Attaching exit orders to entry ${entryOrder.id} (${entryOrder.symbol} ${entryOrder.side})`);

    // Validate exit config
    if (!config.enableStopLoss && !config.enableTakeProfit && !config.enableTrailingStop) {
      throw new BadRequestException('At least one exit type must be enabled');
    }

    // Input sanitization: validate numeric config values are finite and non-negative
    // This is defense-in-depth against NaN/Infinity/negative values that could bypass validation
    this.validateExitConfigInputs(config);

    // Get entry price (use average or executed price)
    const entryPrice = entryOrder.averagePrice || entryOrder.price || 0;
    if (entryPrice <= 0) {
      throw new BadRequestException('Entry order must have a valid price');
    }

    // Get user from the entry order relation
    // The user relation must be loaded on the entry order
    const user = entryOrder.user;
    if (!user) {
      throw new BadRequestException('User not found for entry order. Ensure entry order has user relation loaded.');
    }

    const exchangeKey = entryOrder.exchangeKeyId
      ? await this.exchangeKeyService.findOne(entryOrder.exchangeKeyId, user.id)
      : null;

    // Calculate ATR if needed
    let currentAtr: number | undefined;
    if (
      (config.stopLossType === StopLossType.ATR || config.trailingType === TrailingType.ATR) &&
      priceData &&
      priceData.length > 0
    ) {
      currentAtr = await this.calculateCurrentAtr(
        entryOrder.baseCoin?.id || entryOrder.symbol.split('/')[0],
        priceData,
        config.atrPeriod || 14
      );

      if (!currentAtr || isNaN(currentAtr)) {
        warnings.push('ATR calculation failed, falling back to percentage-based stops');
        // Fallback to percentage
        if (config.stopLossType === StopLossType.ATR) {
          config.stopLossType = StopLossType.PERCENTAGE;
          config.stopLossValue = 2.0; // 2% default
        }
      }
    }

    // Calculate exit prices
    const side = entryOrder.side as 'BUY' | 'SELL';
    const calculatedPrices = this.calculateExitPrices(entryPrice, side, config, currentAtr);

    // Validate exit prices for sanity (price manipulation protection)
    const validationResult = this.validateExitPrices(calculatedPrices, side);
    if (!validationResult.isValid) {
      const errorMessages = validationResult.errors.map((e) => e.message).join('; ');
      this.logger.error(`Exit price validation failed: ${errorMessages}`);
      throw new BadRequestException(`Invalid exit prices: ${errorMessages}`);
    }

    // Start transaction for exit order creation
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let stopLossOrder: Order | undefined;
    let takeProfitOrder: Order | undefined;
    let trailingStopOrder: Order | undefined;
    let ocoLinked = false;

    try {
      // Get exchange client if available (with resilience)
      let exchangeClient: ccxt.Exchange | null = null;
      let exchangeSlug: string | undefined;
      let marketLimits: ExchangeMarketLimits | null = null;

      if (exchangeKey?.exchange) {
        exchangeSlug = exchangeKey.exchange.slug;
        try {
          exchangeClient = await this.executeWithResilience(
            exchangeSlug,
            () => this.exchangeManagerService.getExchangeClient(exchangeSlug!, user),
            'getExchangeClient'
          );
          await this.executeWithResilience(exchangeSlug, () => exchangeClient!.loadMarkets(), 'loadMarkets');
          // Get market limits for quantity validation
          marketLimits = this.getMarketLimits(exchangeClient, entryOrder.symbol);
        } catch (clientError) {
          // Log but continue - we can still create tracking orders without exchange
          if (clientError instanceof CircuitOpenError) {
            warnings.push(`Exchange ${exchangeSlug} circuit open - orders will be tracked locally`);
          } else {
            warnings.push(`Exchange client initialization failed: ${clientError.message}`);
          }
          this.logger.warn(`Exchange client unavailable for ${exchangeSlug}: ${clientError.message}`);
          exchangeClient = null;
        }
      }

      // Determine exit order side (opposite of entry)
      const exitSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';

      // Get raw quantity from entry order
      const rawQuantity = entryOrder.executedQuantity || entryOrder.quantity;

      // Validate quantity for stop loss
      let stopLossQuantity = rawQuantity;
      if (config.enableStopLoss && calculatedPrices.stopLossPrice) {
        const slValidation = this.validateExitOrderQuantity(rawQuantity, calculatedPrices.stopLossPrice, marketLimits);
        if (!slValidation.isValid) {
          warnings.push(`Stop loss quantity invalid: ${slValidation.error}`);
          this.logger.warn(`Stop loss quantity validation failed: ${slValidation.error}`);
        } else {
          stopLossQuantity = slValidation.adjustedQuantity;
          if (slValidation.adjustedQuantity !== slValidation.originalQuantity) {
            this.logger.debug(
              `Stop loss quantity adjusted from ${slValidation.originalQuantity} to ${slValidation.adjustedQuantity}`
            );
          }
        }
      }

      // Validate quantity for take profit
      let takeProfitQuantity = rawQuantity;
      if (config.enableTakeProfit && calculatedPrices.takeProfitPrice) {
        const tpValidation = this.validateExitOrderQuantity(
          rawQuantity,
          calculatedPrices.takeProfitPrice,
          marketLimits
        );
        if (!tpValidation.isValid) {
          warnings.push(`Take profit quantity invalid: ${tpValidation.error}`);
          this.logger.warn(`Take profit quantity validation failed: ${tpValidation.error}`);
        } else {
          takeProfitQuantity = tpValidation.adjustedQuantity;
          if (tpValidation.adjustedQuantity !== tpValidation.originalQuantity) {
            this.logger.debug(
              `Take profit quantity adjusted from ${tpValidation.originalQuantity} to ${tpValidation.adjustedQuantity}`
            );
          }
        }
      }

      // Place stop loss order (using validated quantity)
      if (config.enableStopLoss && calculatedPrices.stopLossPrice && stopLossQuantity > 0) {
        try {
          stopLossOrder = await this.placeStopLossOrder(
            {
              userId: user.id,
              exchangeKeyId: entryOrder.exchangeKeyId || '',
              symbol: entryOrder.symbol,
              side: exitSide,
              quantity: stopLossQuantity,
              price: calculatedPrices.stopLossPrice,
              orderType: 'stop_loss',
              stopPrice: calculatedPrices.stopLossPrice
            },
            exchangeClient,
            user,
            exchangeKey,
            queryRunner,
            exchangeSlug
          );
        } catch (slError) {
          warnings.push(`Stop loss placement failed: ${slError.message}`);
          this.logger.warn(`Failed to place stop loss: ${slError.message}`);
        }
      }

      // Place take profit order (using validated quantity)
      if (config.enableTakeProfit && calculatedPrices.takeProfitPrice && takeProfitQuantity > 0) {
        try {
          takeProfitOrder = await this.placeTakeProfitOrder(
            {
              userId: user.id,
              exchangeKeyId: entryOrder.exchangeKeyId || '',
              symbol: entryOrder.symbol,
              side: exitSide,
              quantity: takeProfitQuantity,
              price: calculatedPrices.takeProfitPrice,
              orderType: 'take_profit'
            },
            exchangeClient,
            user,
            exchangeKey,
            queryRunner,
            exchangeSlug
          );
        } catch (tpError) {
          warnings.push(`Take profit placement failed: ${tpError.message}`);
          this.logger.warn(`Failed to place take profit: ${tpError.message}`);
        }
      }

      // Link as OCO if both exist and config enables it
      if (config.useOco && stopLossOrder && takeProfitOrder && exchangeSlug) {
        const ocoSupport = this.checkExchangeOcoSupport(exchangeSlug);

        if (ocoSupport.native && exchangeClient) {
          try {
            await this.linkOcoOrdersNative(stopLossOrder, takeProfitOrder, exchangeClient);
            ocoLinked = true;
          } catch (ocoError) {
            warnings.push(`Native OCO linking failed: ${ocoError.message}`);
            // Will use simulated OCO via position monitor
          }
        }

        // Even without native OCO, mark as linked for simulated OCO
        if (!ocoLinked && ocoSupport.simulated) {
          stopLossOrder.ocoLinkedOrderId = takeProfitOrder.id;
          takeProfitOrder.ocoLinkedOrderId = stopLossOrder.id;
          await queryRunner.manager.save(stopLossOrder);
          await queryRunner.manager.save(takeProfitOrder);
          ocoLinked = true;
          this.logger.log('OCO orders linked for simulated monitoring');
        }
      }

      // Create position exit tracking record
      const positionExit = queryRunner.manager.create(PositionExit, {
        positionId: entryOrder.algorithmActivationId, // Link to strategy position if available
        entryOrder,
        entryOrderId: entryOrder.id,
        stopLossOrder,
        stopLossOrderId: stopLossOrder?.id,
        takeProfitOrder,
        takeProfitOrderId: takeProfitOrder?.id,
        trailingStopOrder,
        trailingStopOrderId: trailingStopOrder?.id,
        entryPrice,
        stopLossPrice: calculatedPrices.stopLossPrice,
        takeProfitPrice: calculatedPrices.takeProfitPrice,
        currentTrailingStopPrice: calculatedPrices.trailingStopPrice,
        trailingHighWaterMark: side === 'BUY' ? entryPrice : undefined,
        trailingLowWaterMark: side === 'SELL' ? entryPrice : undefined,
        trailingActivated: config.trailingActivation === TrailingActivationType.IMMEDIATE,
        ocoLinked,
        exitConfig: config,
        status: PositionExitStatus.ACTIVE,
        symbol: entryOrder.symbol,
        quantity: entryOrder.executedQuantity || entryOrder.quantity,
        side,
        user,
        userId: user.id,
        strategyConfigId: entryOrder.strategyConfigId,
        exchangeKeyId: entryOrder.exchangeKeyId,
        entryAtr: currentAtr,
        warnings: warnings.length > 0 ? warnings : undefined
      });

      const savedPositionExit = await queryRunner.manager.save(positionExit);

      await queryRunner.commitTransaction();

      this.logger.log(
        `Exit orders attached: SL=${stopLossOrder?.id || 'none'}, TP=${takeProfitOrder?.id || 'none'}, ` +
          `OCO=${ocoLinked}, PositionExit=${savedPositionExit.id}`
      );

      return {
        positionExitId: savedPositionExit.id,
        stopLossOrderId: stopLossOrder?.id,
        takeProfitOrderId: takeProfitOrder?.id,
        trailingStopOrderId: trailingStopOrder?.id,
        calculatedPrices,
        ocoLinked,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Failed to attach exit orders: ${error.message}`, error.stack);
      throw new BadRequestException(`Failed to attach exit orders: ${error.message}`);
    } finally {
      await queryRunner.release();
    }
  }

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
   *
   * @param calculatedPrices - The calculated exit prices to validate
   * @param side - Position side (BUY = long, SELL = short)
   * @param limits - Validation limits (uses defaults if not provided)
   * @returns Validation result with any errors
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
        // For stop loss: long expects below entry, short expects above
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
        // For take profit: long expects above entry, short expects below
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
        // For trailing stop initial price: same as stop loss logic
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
    const distancePercentage = Math.abs((price - entryPrice) / entryPrice) * 100;

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
      return errors; // Early return, no point checking other validations
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
  private validateExitConfigInputs(config: ExitConfig): void {
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
        // FIXED type: absolute price, cap at reasonable maximum (10 million)
        validateNumeric(config.stopLossValue, 'stopLossValue', 10_000_000);
      } else if (config.stopLossType === StopLossType.PERCENTAGE) {
        // Percentage type: must be between 0 and 100 (will be further validated against limits)
        validateNumeric(config.stopLossValue, 'stopLossValue', 100);
      } else if (config.stopLossType === StopLossType.ATR) {
        // ATR multiplier: reasonable range 0.1 to 10
        validateNumeric(config.stopLossValue, 'stopLossValue', 10);
      }
    }

    // Validate take profit inputs
    if (config.enableTakeProfit) {
      if (config.takeProfitType === TakeProfitType.FIXED) {
        // FIXED type: absolute price, cap at reasonable maximum (100 million)
        validateNumeric(config.takeProfitValue, 'takeProfitValue', 100_000_000);
      } else if (config.takeProfitType === TakeProfitType.PERCENTAGE) {
        // Percentage type: must be between 0 and 1000 (up to 10x)
        validateNumeric(config.takeProfitValue, 'takeProfitValue', 1000);
      } else if (config.takeProfitType === TakeProfitType.RISK_REWARD) {
        // Risk:reward ratio: reasonable range 0.1 to 100
        validateNumeric(config.takeProfitValue, 'takeProfitValue', 100);
      }
    }

    // Validate trailing stop inputs
    if (config.enableTrailingStop) {
      if (config.trailingType === TrailingType.AMOUNT) {
        // Amount type: absolute value, cap at reasonable maximum
        validateNumeric(config.trailingValue, 'trailingValue', 10_000_000);
      } else if (config.trailingType === TrailingType.PERCENTAGE) {
        // Percentage type: must be between 0 and 100
        validateNumeric(config.trailingValue, 'trailingValue', 100);
      } else if (config.trailingType === TrailingType.ATR) {
        // ATR multiplier: reasonable range 0.1 to 10
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
   * Get market limits from exchange client
   * Extracts minimum order size, step size, and notional requirements
   */
  private getMarketLimits(exchangeClient: ccxt.Exchange, symbol: string): ExchangeMarketLimits | null {
    try {
      const market = exchangeClient.markets?.[symbol];
      if (!market) {
        this.logger.warn(`Market ${symbol} not found in exchange markets`);
        return null;
      }

      return {
        minAmount: market.limits?.amount?.min ?? 0,
        maxAmount: market.limits?.amount?.max ?? Number.MAX_SAFE_INTEGER,
        amountStep: market.precision?.amount ?? 8,
        minCost: market.limits?.cost?.min ?? 0,
        pricePrecision: market.precision?.price ?? 8,
        amountPrecision: market.precision?.amount ?? 8
      };
    } catch (error) {
      this.logger.warn(`Failed to get market limits for ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate and adjust exit order quantity against exchange requirements
   *
   * Checks:
   * - Quantity is above minimum order size
   * - Quantity meets minimum notional value (quantity × price)
   * - Quantity is aligned to step size precision
   *
   * @param quantity - Requested quantity
   * @param price - Order price (for notional calculation)
   * @param limits - Exchange market limits
   * @returns Validation result with adjusted quantity
   */
  validateExitOrderQuantity(
    quantity: number,
    price: number,
    limits: ExchangeMarketLimits | null
  ): QuantityValidationResult {
    // If no limits available, accept the quantity as-is
    if (!limits) {
      return {
        isValid: true,
        originalQuantity: quantity,
        adjustedQuantity: quantity,
        minQuantity: 0,
        minNotional: 0,
        actualNotional: quantity * price
      };
    }

    const { minAmount, amountStep, minCost, amountPrecision } = limits;

    // Align quantity to step size (floor to avoid exceeding available balance)
    const precision = typeof amountPrecision === 'number' ? amountPrecision : 8;
    const step = typeof amountStep === 'number' ? Math.pow(10, -amountStep) : amountStep;
    const adjustedQuantity = Number((Math.floor(quantity / step) * step).toFixed(precision));

    // Calculate notional value
    const actualNotional = adjustedQuantity * price;

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
      const requiredQuantity = Math.ceil(minCost / price / step) * step;
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
   * Calculate stop loss price
   */
  private calculateStopLossPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): number {
    let stopDistance: number;

    switch (config.stopLossType) {
      case StopLossType.FIXED:
        return config.stopLossValue;

      case StopLossType.PERCENTAGE:
        stopDistance = entryPrice * (config.stopLossValue / 100);
        break;

      case StopLossType.ATR:
        if (!currentAtr || isNaN(currentAtr)) {
          // Fallback to 2% if ATR not available
          stopDistance = entryPrice * 0.02;
          this.logger.warn('ATR not available for stop loss, using 2% fallback');
        } else {
          stopDistance = currentAtr * config.stopLossValue;
        }
        break;

      default:
        stopDistance = entryPrice * 0.02;
    }

    // Long position: stop below entry, Short position: stop above entry
    return side === 'BUY' ? entryPrice - stopDistance : entryPrice + stopDistance;
  }

  /**
   * Calculate take profit price
   */
  private calculateTakeProfitPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    stopLossPrice?: number
  ): number {
    let profitDistance: number;

    switch (config.takeProfitType) {
      case TakeProfitType.FIXED:
        return config.takeProfitValue;

      case TakeProfitType.PERCENTAGE:
        profitDistance = entryPrice * (config.takeProfitValue / 100);
        break;

      case TakeProfitType.RISK_REWARD:
        if (!stopLossPrice) {
          // Fallback to 4% if no stop loss for R:R calculation
          profitDistance = entryPrice * 0.04;
          this.logger.warn('No stop loss for R:R calculation, using 4% fallback');
        } else {
          const riskDistance = Math.abs(entryPrice - stopLossPrice);
          profitDistance = riskDistance * config.takeProfitValue;
        }
        break;

      default:
        profitDistance = entryPrice * 0.04;
    }

    // Long position: profit above entry, Short position: profit below entry
    return side === 'BUY' ? entryPrice + profitDistance : entryPrice - profitDistance;
  }

  /**
   * Calculate initial trailing stop price
   */
  private calculateTrailingStopPrice(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    config: ExitConfig,
    currentAtr?: number
  ): number {
    let trailingDistance: number;

    switch (config.trailingType) {
      case TrailingType.AMOUNT:
        trailingDistance = config.trailingValue;
        break;

      case TrailingType.PERCENTAGE:
        trailingDistance = entryPrice * (config.trailingValue / 100);
        break;

      case TrailingType.ATR:
        if (!currentAtr || isNaN(currentAtr)) {
          trailingDistance = entryPrice * 0.01; // 1% fallback
        } else {
          trailingDistance = currentAtr * config.trailingValue;
        }
        break;

      default:
        trailingDistance = entryPrice * 0.01;
    }

    return side === 'BUY' ? entryPrice - trailingDistance : entryPrice + trailingDistance;
  }

  /**
   * Calculate trailing stop activation price
   */
  private calculateTrailingActivationPrice(entryPrice: number, side: 'BUY' | 'SELL', config: ExitConfig): number {
    switch (config.trailingActivation) {
      case TrailingActivationType.PRICE:
        return config.trailingActivationValue || entryPrice;

      case TrailingActivationType.PERCENTAGE: {
        const activationGain = entryPrice * ((config.trailingActivationValue || 1) / 100);
        return side === 'BUY' ? entryPrice + activationGain : entryPrice - activationGain;
      }

      default:
        return entryPrice;
    }
  }

  /**
   * Calculate current ATR value from price data
   */
  private async calculateCurrentAtr(
    coinId: string,
    priceData: PriceSummary[],
    period: number
  ): Promise<number | undefined> {
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
    } catch (error) {
      this.logger.error(`ATR calculation failed: ${error.message}`);
      return undefined;
    }
  }

  /**
   * Lookup base and quote coins for a trading symbol
   * @param symbol - Trading pair symbol (e.g., 'BTC/USDT')
   * @returns Object containing baseCoin and quoteCoin (or null if not found)
   */
  private async lookupCoinsForSymbol(symbol: string): Promise<{ baseCoin: Coin | null; quoteCoin: Coin | null }> {
    const [baseSymbol, quoteSymbol] = symbol.split('/');
    let baseCoin: Coin | null = null;
    let quoteCoin: Coin | null = null;

    try {
      const coins = await this.coinService.getMultipleCoinsBySymbol([baseSymbol, quoteSymbol]);
      baseCoin = coins.find((c) => c.symbol.toLowerCase() === baseSymbol.toLowerCase()) || null;
      quoteCoin = coins.find((c) => c.symbol.toLowerCase() === quoteSymbol.toLowerCase()) || null;

      if (!baseCoin) {
        this.logger.debug(`Base coin ${baseSymbol} not found in database`);
      }
      if (!quoteCoin) {
        this.logger.debug(`Quote coin ${quoteSymbol} not found in database`);
      }
    } catch (error) {
      this.logger.warn(`Could not lookup coins for symbol ${symbol}: ${error.message}`);
    }

    return { baseCoin, quoteCoin };
  }

  /**
   * Place stop loss order on exchange (with resilience)
   */
  private async placeStopLossOrder(
    params: PlaceExitOrderParams,
    exchangeClient: ccxt.Exchange | null,
    user: User,
    exchangeKey: ExchangeKey | null,
    queryRunner: QueryRunner,
    exchangeSlug?: string
  ): Promise<Order> {
    let ccxtOrder: ccxt.Order | null = null;

    if (exchangeClient && exchangeSlug) {
      try {
        ccxtOrder = await this.executeWithResilience(
          exchangeSlug,
          () =>
            exchangeClient!.createOrder(
              params.symbol,
              'stop_loss',
              params.side.toLowerCase(),
              params.quantity,
              undefined, // No limit price for market stop
              { stopPrice: params.stopPrice }
            ),
          'createStopLossOrder'
        );
      } catch (exchangeError) {
        this.logger.warn(`Exchange stop loss creation failed: ${exchangeError.message}`);
        // Will create a tracking order for monitoring
      }
    }

    // Lookup coins for the symbol
    const { baseCoin, quoteCoin } = await this.lookupCoinsForSymbol(params.symbol);

    // Create order entity
    const order = queryRunner.manager.create(Order, {
      orderId: ccxtOrder?.id?.toString() || `sl_pending_${randomUUID()}`,
      clientOrderId: ccxtOrder?.clientOrderId || `sl_pending_${randomUUID()}`,
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: OrderType.STOP_LOSS,
      quantity: params.quantity,
      price: 0, // Market order
      executedQuantity: 0,
      status: ccxtOrder ? OrderStatus.NEW : OrderStatus.NEW, // Mark as pending if not placed
      transactTime: new Date(),
      isManual: false,
      exchangeKeyId: params.exchangeKeyId,
      stopPrice: params.stopPrice,
      stopLossPrice: params.stopPrice,
      user,
      baseCoin: baseCoin || undefined,
      quoteCoin: quoteCoin || undefined,
      exchange: exchangeKey?.exchange,
      info: ccxtOrder?.info
    });

    return queryRunner.manager.save(order);
  }

  /**
   * Place take profit order on exchange (with resilience)
   */
  private async placeTakeProfitOrder(
    params: PlaceExitOrderParams,
    exchangeClient: ccxt.Exchange | null,
    user: User,
    exchangeKey: ExchangeKey | null,
    queryRunner: QueryRunner,
    exchangeSlug?: string
  ): Promise<Order> {
    let ccxtOrder: ccxt.Order | null = null;

    if (exchangeClient && exchangeSlug) {
      try {
        // Take profit is typically a limit order
        ccxtOrder = await this.executeWithResilience(
          exchangeSlug,
          () =>
            exchangeClient!.createOrder(
              params.symbol,
              'limit',
              params.side.toLowerCase(),
              params.quantity,
              params.price
            ),
          'createTakeProfitOrder'
        );
      } catch (exchangeError) {
        this.logger.warn(`Exchange take profit creation failed: ${exchangeError.message}`);
      }
    }

    // Lookup coins for the symbol
    const { baseCoin, quoteCoin } = await this.lookupCoinsForSymbol(params.symbol);

    // Create order entity
    const order = queryRunner.manager.create(Order, {
      orderId: ccxtOrder?.id?.toString() || `tp_pending_${randomUUID()}`,
      clientOrderId: ccxtOrder?.clientOrderId || `tp_pending_${randomUUID()}`,
      symbol: params.symbol,
      side: params.side as OrderSide,
      type: OrderType.TAKE_PROFIT,
      quantity: params.quantity,
      price: params.price,
      executedQuantity: 0,
      status: ccxtOrder ? OrderStatus.NEW : OrderStatus.NEW,
      transactTime: new Date(),
      isManual: false,
      exchangeKeyId: params.exchangeKeyId,
      takeProfitPrice: params.price,
      user,
      baseCoin: baseCoin || undefined,
      quoteCoin: quoteCoin || undefined,
      exchange: exchangeKey?.exchange,
      info: ccxtOrder?.info
    });

    return queryRunner.manager.save(order);
  }

  /**
   * Link OCO orders natively on exchange (for exchanges that support it)
   */
  private async linkOcoOrdersNative(
    stopLossOrder: Order,
    takeProfitOrder: Order,
    exchangeClient: ccxt.Exchange
  ): Promise<void> {
    // Most exchanges don't support modifying orders to link them after creation
    // This would typically require creating a native OCO order type
    // For now, we rely on simulated OCO via the position monitor
    this.logger.log('Native OCO linking not implemented, using simulated OCO');
  }

  /**
   * Check exchange OCO support
   */
  checkExchangeOcoSupport(exchangeSlug: string): ExchangeOcoSupport {
    return this.exchangeOcoSupport[exchangeSlug] || { native: false, simulated: true };
  }

  /**
   * Handle OCO fill - cancel the other leg when one fills
   */
  async handleOcoFill(filledOrderId: string): Promise<void> {
    // Find position exit record with this order
    const positionExit = await this.positionExitRepo.findOne({
      where: [{ stopLossOrderId: filledOrderId }, { takeProfitOrderId: filledOrderId }],
      relations: ['user', 'stopLossOrder', 'takeProfitOrder']
    });

    if (!positionExit || !positionExit.ocoLinked) {
      return;
    }

    // Determine which order filled and which to cancel
    const isStopLossFilled = positionExit.stopLossOrderId === filledOrderId;
    const otherOrderId = isStopLossFilled ? positionExit.takeProfitOrderId : positionExit.stopLossOrderId;

    if (otherOrderId) {
      await this.cancelOrderById(otherOrderId, positionExit.user);
    }

    // Update position exit status
    positionExit.status = isStopLossFilled
      ? PositionExitStatus.STOP_LOSS_TRIGGERED
      : PositionExitStatus.TAKE_PROFIT_TRIGGERED;
    positionExit.triggeredAt = new Date();

    // Get exit price from filled order
    const filledOrder = await this.orderRepo.findOneBy({ id: filledOrderId });
    if (filledOrder) {
      positionExit.exitPrice = filledOrder.averagePrice || filledOrder.price;
      positionExit.realizedPnL = this.calculateRealizedPnL(
        positionExit.entryPrice,
        positionExit.exitPrice,
        positionExit.quantity,
        positionExit.side
      );
    }

    await this.positionExitRepo.save(positionExit);

    this.logger.log(
      `OCO fill handled: ${isStopLossFilled ? 'SL' : 'TP'} triggered, cancelled ${isStopLossFilled ? 'TP' : 'SL'}`
    );
  }

  /**
   * Cancel an order by ID (with resilience)
   */
  private async cancelOrderById(orderId: string, user: User): Promise<void> {
    try {
      const order = await this.orderRepo.findOne({
        where: { id: orderId },
        relations: ['exchange']
      });

      if (!order) {
        this.logger.warn(`Order ${orderId} not found for cancellation`);
        return;
      }

      // Try to cancel on exchange if we have exchange key (with resilience)
      if (order.exchangeKeyId && order.exchange) {
        const exchangeSlug = order.exchange.slug;
        try {
          const exchangeKey = await this.exchangeKeyService.findOne(order.exchangeKeyId, user.id);
          if (exchangeKey) {
            const exchangeClient = await this.executeWithResilience(
              exchangeSlug,
              () => this.exchangeManagerService.getExchangeClient(exchangeSlug, user),
              'getExchangeClient'
            );
            await this.executeWithResilience(
              exchangeSlug,
              () => exchangeClient.cancelOrder(order.orderId, order.symbol),
              'cancelOrder'
            );
          }
        } catch (cancelError) {
          this.logger.warn(`Exchange order cancellation failed: ${cancelError.message}`);
        }
      }

      // Update order status in DB
      order.status = OrderStatus.CANCELED;
      await this.orderRepo.save(order);

      this.logger.log(`Order ${orderId} cancelled`);
    } catch (error) {
      this.logger.error(`Failed to cancel order ${orderId}: ${error.message}`);
    }
  }

  /**
   * Cancel all exit orders for a position
   */
  async cancelExitOrders(positionExitId: string, user: User): Promise<void> {
    const positionExit = await this.positionExitRepo.findOne({
      where: { id: positionExitId, userId: user.id },
      relations: ['stopLossOrder', 'takeProfitOrder', 'trailingStopOrder']
    });

    if (!positionExit) {
      throw new BadRequestException('Position exit not found');
    }

    // Cancel all exit orders
    if (positionExit.stopLossOrderId) {
      await this.cancelOrderById(positionExit.stopLossOrderId, user);
    }
    if (positionExit.takeProfitOrderId) {
      await this.cancelOrderById(positionExit.takeProfitOrderId, user);
    }
    if (positionExit.trailingStopOrderId) {
      await this.cancelOrderById(positionExit.trailingStopOrderId, user);
    }

    // Update position exit status
    positionExit.status = PositionExitStatus.CANCELLED;
    await this.positionExitRepo.save(positionExit);

    this.logger.log(`All exit orders cancelled for position exit ${positionExitId}`);
  }

  /**
   * Calculate realized P&L from exit
   */
  private calculateRealizedPnL(entryPrice: number, exitPrice: number, quantity: number, side: 'BUY' | 'SELL'): number {
    if (side === 'BUY') {
      // Long position: profit when exit > entry
      return (exitPrice - entryPrice) * quantity;
    } else {
      // Short position: profit when exit < entry
      return (entryPrice - exitPrice) * quantity;
    }
  }

  /**
   * Get active position exits for monitoring
   */
  async getActivePositionExits(): Promise<PositionExit[]> {
    return this.positionExitRepo.find({
      where: { status: PositionExitStatus.ACTIVE },
      relations: ['user', 'entryOrder', 'stopLossOrder', 'takeProfitOrder']
    });
  }

  /**
   * Get position exits with trailing stops that need monitoring
   */
  async getActiveTrailingStops(): Promise<PositionExit[]> {
    return this.positionExitRepo
      .createQueryBuilder('pe')
      .where('pe.status = :status', { status: PositionExitStatus.ACTIVE })
      .andWhere("pe.exitConfig->>'enableTrailingStop' = :enabled", { enabled: 'true' })
      .leftJoinAndSelect('pe.user', 'user')
      .leftJoinAndSelect('pe.entryOrder', 'entryOrder')
      .getMany();
  }

  /**
   * Update trailing stop price for a position
   */
  async updateTrailingStopPrice(positionExitId: string, newStopPrice: number, highWaterMark: number): Promise<void> {
    await this.positionExitRepo.update(positionExitId, {
      currentTrailingStopPrice: newStopPrice,
      trailingHighWaterMark: highWaterMark,
      trailingActivated: true
    });
  }
}
