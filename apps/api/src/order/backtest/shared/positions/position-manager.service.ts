import { Injectable } from '@nestjs/common';

import {
  ClosePositionInput,
  CONFIDENCE_EXIT_MAX_PERCENT,
  CONFIDENCE_EXIT_MIN_PERCENT,
  DEFAULT_POSITION_CONFIG,
  IPositionManager,
  OpenPositionInput,
  Position,
  PositionActionResult,
  PositionSizingConfig,
  PositionValidationError
} from './position-manager.interface';

/**
 * Position Manager Service
 *
 * Provides position lifecycle management for backtesting including:
 * - Opening and increasing positions
 * - Closing and reducing positions
 * - Position sizing based on confidence
 * - Position validation and limits
 *
 * @example
 * ```typescript
 * // Open a new position
 * const result = positionManager.openPosition(undefined, {
 *   coinId: 'bitcoin',
 *   price: 50000,
 *   confidence: 0.8,
 *   availableCapital: 100000,
 *   portfolioValue: 100000
 * });
 *
 * // Close a position
 * const closeResult = positionManager.closePosition(existingPosition, {
 *   coinId: 'bitcoin',
 *   price: 55000,
 *   percentage: 0.5  // Sell 50%
 * });
 * ```
 */
@Injectable()
export class PositionManagerService implements IPositionManager {
  /**
   * Open or increase a position
   */
  openPosition(
    existingPosition: Position | undefined,
    input: OpenPositionInput,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): PositionActionResult {
    // Validate input
    const validation = this.validatePosition('open', existingPosition, input, 0, config);
    if (validation) {
      return {
        success: false,
        quantity: 0,
        price: input.price,
        totalValue: 0,
        error: validation.message
      };
    }

    // Calculate quantity based on input priority: quantity > percentage > confidence
    let quantity: number;

    if (input.quantity !== undefined && input.quantity > 0) {
      quantity = input.quantity;
    } else if (input.percentage !== undefined && input.percentage > 0) {
      const investmentAmount = input.portfolioValue * input.percentage;
      quantity = investmentAmount / input.price;
    } else if (input.confidence !== undefined) {
      quantity = this.calculatePositionSize(input.portfolioValue, input.confidence, input.price, config);
    } else {
      // Default to minimum allocation
      const minAllocation = config.minAllocation ?? DEFAULT_POSITION_CONFIG.minAllocation ?? 0.05;
      const investmentAmount = input.portfolioValue * minAllocation;
      quantity = investmentAmount / input.price;
    }

    // Validate we have enough capital
    const totalValue = quantity * input.price;
    if (totalValue > input.availableCapital) {
      return {
        success: false,
        quantity: 0,
        price: input.price,
        totalValue: 0,
        error: 'Insufficient capital for trade'
      };
    }

    // Calculate new position (or update existing)
    let newPosition: Position;

    if (existingPosition && existingPosition.quantity > 0) {
      // Increase existing position - calculate new average price
      const newQuantity = existingPosition.quantity + quantity;
      const newAveragePrice =
        (existingPosition.averagePrice * existingPosition.quantity + input.price * quantity) / newQuantity;

      newPosition = {
        coinId: input.coinId,
        quantity: newQuantity,
        averagePrice: newAveragePrice,
        totalValue: newQuantity * input.price
      };
    } else {
      // New position
      newPosition = {
        coinId: input.coinId,
        quantity,
        averagePrice: input.price,
        totalValue: totalValue
      };
    }

    return {
      success: true,
      position: newPosition,
      quantity,
      price: input.price,
      totalValue
    };
  }

  /**
   * Close or reduce a position
   */
  closePosition(
    position: Position,
    input: ClosePositionInput,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): PositionActionResult {
    // Validate input
    const validation = this.validatePosition('close', position, input, 0, config);
    if (validation) {
      return {
        success: false,
        quantity: 0,
        price: input.price,
        totalValue: 0,
        error: validation.message
      };
    }

    // Calculate quantity based on input priority: quantity > percentage > confidence
    let quantity: number;

    if (input.quantity !== undefined && input.quantity > 0) {
      quantity = Math.min(input.quantity, position.quantity);
    } else if (input.percentage !== undefined && input.percentage > 0) {
      quantity = position.quantity * Math.min(1, input.percentage);
    } else if (input.confidence !== undefined) {
      // Higher confidence = sell more (scales from MIN to MAX of position)
      const exitRange = CONFIDENCE_EXIT_MAX_PERCENT - CONFIDENCE_EXIT_MIN_PERCENT;
      const confidenceBasedPercent = CONFIDENCE_EXIT_MIN_PERCENT + input.confidence * exitRange;
      quantity = position.quantity * confidenceBasedPercent;
    } else {
      // Default: sell entire position
      quantity = position.quantity;
    }

    // Ensure we don't sell more than we have
    quantity = Math.min(quantity, position.quantity);

    const totalValue = quantity * input.price;
    const costBasis = position.averagePrice;

    // Calculate realized P&L: (sell price - cost basis) * quantity
    const realizedPnL = (input.price - costBasis) * quantity;
    const realizedPnLPercent = costBasis > 0 ? (input.price - costBasis) / costBasis : 0;

    // Calculate remaining position
    const remainingQuantity = position.quantity - quantity;
    let updatedPosition: Position | undefined;

    if (remainingQuantity > 0) {
      updatedPosition = {
        coinId: input.coinId,
        quantity: remainingQuantity,
        averagePrice: position.averagePrice, // Average price doesn't change on partial close
        totalValue: remainingQuantity * input.price
      };
    }

    return {
      success: true,
      position: updatedPosition,
      realizedPnL,
      realizedPnLPercent,
      costBasis,
      quantity,
      price: input.price,
      totalValue
    };
  }

  /**
   * Calculate position size based on confidence level
   * Higher confidence = larger position (scaled between min and max allocation)
   */
  calculatePositionSize(
    portfolioValue: number,
    confidence: number,
    price: number,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): number {
    const minAllocation = config.minAllocation ?? DEFAULT_POSITION_CONFIG.minAllocation ?? 0.05;
    const maxAllocation = config.maxAllocation ?? DEFAULT_POSITION_CONFIG.maxAllocation ?? 0.2;

    // Clamp confidence to [0, 1]
    const clampedConfidence = Math.max(0, Math.min(1, confidence));

    // Scale allocation between min and max based on confidence
    const allocation = minAllocation + clampedConfidence * (maxAllocation - minAllocation);
    const investmentAmount = portfolioValue * allocation;

    return investmentAmount / price;
  }

  /**
   * Validate a position action before execution
   */
  validatePosition(
    action: 'open' | 'close',
    existingPosition: Position | undefined,
    input: OpenPositionInput | ClosePositionInput,
    openPositionsCount: number,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): PositionValidationError | undefined {
    // Validate price
    if (input.price <= 0) {
      return {
        code: 'INVALID_PRICE',
        message: 'Price must be greater than zero'
      };
    }

    if (action === 'open') {
      const openInput = input as OpenPositionInput;

      // Validate quantity if provided
      if (openInput.quantity !== undefined) {
        if (openInput.quantity === 0) {
          return {
            code: 'ZERO_QUANTITY',
            message: 'Quantity must be greater than zero'
          };
        }
        if (openInput.quantity < 0) {
          return {
            code: 'NEGATIVE_QUANTITY',
            message: 'Quantity cannot be negative'
          };
        }
      }

      // Check max positions (only for new positions)
      const maxPositions = config.maxPositions ?? DEFAULT_POSITION_CONFIG.maxPositions ?? 20;
      if (!existingPosition && openPositionsCount >= maxPositions) {
        return {
          code: 'MAX_POSITIONS',
          message: `Maximum number of positions (${maxPositions}) reached`
        };
      }
    } else {
      // Close action
      const closeInput = input as ClosePositionInput;

      // Validate position exists
      if (!existingPosition || existingPosition.quantity === 0) {
        return {
          code: 'NO_POSITION',
          message: 'No position to close'
        };
      }

      // Validate quantity if provided
      if (closeInput.quantity !== undefined) {
        if (closeInput.quantity === 0) {
          return {
            code: 'ZERO_QUANTITY',
            message: 'Quantity must be greater than zero'
          };
        }
        if (closeInput.quantity < 0) {
          return {
            code: 'NEGATIVE_QUANTITY',
            message: 'Quantity cannot be negative'
          };
        }
      }
    }

    return undefined;
  }

  /**
   * Update position value with current market price
   */
  updatePositionValue(position: Position, currentPrice: number): Position {
    return {
      ...position,
      totalValue: position.quantity * currentPrice
    };
  }
}
