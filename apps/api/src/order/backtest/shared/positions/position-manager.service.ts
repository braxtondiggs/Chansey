import { Injectable } from '@nestjs/common';

import { MAINTENANCE_MARGIN_RATE } from '@chansey/api-interfaces';

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

@Injectable()
export class PositionManagerService implements IPositionManager {
  openPosition(
    existingPosition: Position | undefined,
    input: OpenPositionInput,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): PositionActionResult {
    const validation = this.validatePosition('open', existingPosition, input, 0, config);
    if (validation) {
      return this.failureResult(input.price, validation.message);
    }

    const quantity = this.resolveOpenQuantity(input, config);

    const totalValue = quantity * input.price;
    if (totalValue > input.availableCapital) {
      return this.failureResult(input.price, 'Insufficient capital for trade');
    }

    let newPosition: Position;

    if (existingPosition && existingPosition.quantity > 0) {
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

  closePosition(
    position: Position,
    input: ClosePositionInput,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): PositionActionResult {
    const validation = this.validatePosition('close', position, input, 0, config);
    if (validation) {
      return this.failureResult(input.price, validation.message);
    }

    let quantity = this.resolveCloseQuantity(input, position.quantity);

    // Ensure we don't sell more than we have
    quantity = Math.min(quantity, position.quantity);

    const totalValue = quantity * input.price;
    const costBasis = position.averagePrice;

    const realizedPnL = (input.price - costBasis) * quantity;
    const realizedPnLPercent = costBasis > 0 ? (input.price - costBasis) / costBasis : 0;

    const remainingQuantity = position.quantity - quantity;
    let updatedPosition: Position | undefined;

    if (remainingQuantity > 0) {
      updatedPosition = {
        coinId: input.coinId,
        quantity: remainingQuantity,
        averagePrice: position.averagePrice,
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

  calculatePositionSize(
    portfolioValue: number,
    confidence: number,
    price: number,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): number {
    const minAllocation = config.minAllocation ?? DEFAULT_POSITION_CONFIG.minAllocation ?? 0.05;
    const maxAllocation = config.maxAllocation ?? DEFAULT_POSITION_CONFIG.maxAllocation ?? 0.2;

    const clampedConfidence = Math.max(0, Math.min(1, confidence));

    const allocation = minAllocation + clampedConfidence * (maxAllocation - minAllocation);
    const investmentAmount = portfolioValue * allocation;

    return investmentAmount / price;
  }

  validatePosition(
    action: 'open' | 'close',
    existingPosition: Position | undefined,
    input: OpenPositionInput | ClosePositionInput,
    openPositionsCount: number,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): PositionValidationError | undefined {
    if (input.price <= 0) {
      return {
        code: 'INVALID_PRICE',
        message: 'Price must be greater than zero'
      };
    }

    if (action === 'open') {
      const openInput = input as OpenPositionInput;

      const quantityError = this.validateQuantity(openInput.quantity);
      if (quantityError) return quantityError;

      const maxPositions = config.maxPositions ?? DEFAULT_POSITION_CONFIG.maxPositions ?? 20;
      if (!existingPosition && openPositionsCount >= maxPositions) {
        return {
          code: 'MAX_POSITIONS',
          message: `Maximum number of positions (${maxPositions}) reached`
        };
      }
    } else {
      const closeInput = input as ClosePositionInput;

      if (!existingPosition || existingPosition.quantity === 0) {
        return {
          code: 'NO_POSITION',
          message: 'No position to close'
        };
      }

      const quantityError = this.validateQuantity(closeInput.quantity);
      if (quantityError) return quantityError;
    }

    return undefined;
  }

  updatePositionValue(position: Position, currentPrice: number): Position {
    if (position.side === 'short' && position.marginAmount !== undefined) {
      return {
        ...position,
        totalValue: Math.max(0, position.marginAmount + (position.averagePrice - currentPrice) * position.quantity)
      };
    }
    return {
      ...position,
      totalValue: position.quantity * currentPrice
    };
  }

  openShort(
    existingPosition: Position | undefined,
    input: OpenPositionInput,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG,
    leverage = 1
  ): PositionActionResult {
    const validation = this.validatePosition('open', existingPosition, input, 0, config);
    if (validation) {
      return this.failureResult(input.price, validation.message);
    }

    const quantity = this.resolveOpenQuantity(input, config);

    const marginAmount = (quantity * input.price) / leverage;

    if (marginAmount > input.availableCapital) {
      return this.failureResult(input.price, 'Insufficient capital for short position margin');
    }

    const liquidationPrice = this.calculateLiquidationPrice(input.price, leverage, 'short');

    const newPosition: Position = {
      coinId: input.coinId,
      quantity,
      averagePrice: input.price,
      totalValue: marginAmount,
      side: 'short',
      leverage,
      marginAmount,
      liquidationPrice
    };

    return {
      success: true,
      position: newPosition,
      quantity,
      price: input.price,
      totalValue: marginAmount,
      marginAmount,
      liquidationPrice
    };
  }

  closeShort(
    position: Position,
    input: ClosePositionInput,
    config: PositionSizingConfig = DEFAULT_POSITION_CONFIG
  ): PositionActionResult {
    const validation = this.validatePosition('close', position, input, 0, config);
    if (validation) {
      return this.failureResult(input.price, validation.message);
    }

    let quantity = this.resolveCloseQuantity(input, position.quantity);

    // Ensure we don't close more than we have
    quantity = Math.min(quantity, position.quantity);

    const costBasis = position.averagePrice;

    // Short P&L is inverted: profit when price drops
    const realizedPnL = (costBasis - input.price) * quantity;
    const realizedPnLPercent = costBasis > 0 ? (costBasis - input.price) / costBasis : 0;

    const returnedMargin = (position.marginAmount ?? 0) * (quantity / position.quantity);

    // Cap loss at margin amount
    const cappedPnL = Math.max(-returnedMargin, realizedPnL);

    const remainingQuantity = position.quantity - quantity;
    let updatedPosition: Position | undefined;

    if (remainingQuantity > 0) {
      const remainingMargin = (position.marginAmount ?? 0) - returnedMargin;
      updatedPosition = {
        coinId: input.coinId,
        quantity: remainingQuantity,
        averagePrice: position.averagePrice,
        totalValue: remainingMargin + (position.averagePrice - input.price) * remainingQuantity,
        side: 'short',
        leverage: position.leverage,
        marginAmount: remainingMargin,
        liquidationPrice: position.liquidationPrice
      };
    }

    return {
      success: true,
      position: updatedPosition,
      realizedPnL: cappedPnL,
      realizedPnLPercent,
      costBasis,
      quantity,
      price: input.price,
      totalValue: returnedMargin,
      marginAmount: returnedMargin,
      liquidationPrice: position.liquidationPrice
    };
  }

  calculateLiquidationPrice(
    entryPrice: number,
    leverage: number,
    side: 'long' | 'short',
    maintenanceMarginRate = MAINTENANCE_MARGIN_RATE
  ): number {
    if (side === 'long') {
      return entryPrice * (1 - 1 / leverage + maintenanceMarginRate);
    }
    // Short: liquidation when price rises
    return entryPrice * (1 + 1 / leverage - maintenanceMarginRate);
  }

  isLiquidated(position: Position, currentPrice: number): boolean {
    if (!position.leverage || position.leverage <= 1) return false;
    if (position.liquidationPrice === undefined) return false;

    if (position.side === 'short') {
      return currentPrice >= position.liquidationPrice;
    }
    return currentPrice <= position.liquidationPrice;
  }

  /** Resolve quantity for opening a position: explicit > percentage > confidence > min allocation */
  private resolveOpenQuantity(input: OpenPositionInput, config: PositionSizingConfig): number {
    if (input.quantity !== undefined && input.quantity > 0) {
      return input.quantity;
    }
    if (input.percentage !== undefined && input.percentage > 0) {
      return (input.portfolioValue * input.percentage) / input.price;
    }
    if (input.confidence !== undefined) {
      return this.calculatePositionSize(input.portfolioValue, input.confidence, input.price, config);
    }
    const minAllocation = config.minAllocation ?? DEFAULT_POSITION_CONFIG.minAllocation ?? 0.05;
    return (input.portfolioValue * minAllocation) / input.price;
  }

  /** Resolve quantity for closing a position: explicit > percentage > confidence > full close, clamped to position size */
  private resolveCloseQuantity(input: ClosePositionInput, positionQuantity: number): number {
    if (input.quantity !== undefined && input.quantity > 0) {
      return Math.min(input.quantity, positionQuantity);
    }
    if (input.percentage !== undefined && input.percentage > 0) {
      return positionQuantity * Math.min(1, input.percentage);
    }
    if (input.confidence !== undefined) {
      const exitRange = CONFIDENCE_EXIT_MAX_PERCENT - CONFIDENCE_EXIT_MIN_PERCENT;
      const confidenceBasedPercent = CONFIDENCE_EXIT_MIN_PERCENT + input.confidence * exitRange;
      return positionQuantity * confidenceBasedPercent;
    }
    return positionQuantity;
  }

  /** Validate an optional quantity field — returns error for zero/negative, undefined for valid/absent */
  private validateQuantity(quantity: number | undefined): PositionValidationError | undefined {
    if (quantity === undefined) return undefined;
    if (quantity === 0) {
      return { code: 'ZERO_QUANTITY', message: 'Quantity must be greater than zero' };
    }
    if (quantity < 0) {
      return { code: 'NEGATIVE_QUANTITY', message: 'Quantity cannot be negative' };
    }
    return undefined;
  }

  /** Standard failure result shape */
  private failureResult(price: number, error: string): PositionActionResult {
    return { success: false, quantity: 0, price, totalValue: 0, error };
  }
}
