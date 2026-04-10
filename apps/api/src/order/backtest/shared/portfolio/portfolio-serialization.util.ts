import { Decimal } from 'decimal.js';

import { type Portfolio, type SerializablePortfolio } from './portfolio-state.interface';

import { type Position } from '../positions';

/**
 * Calculate the value of a single position given an optional current price.
 * For short positions: margin + unrealized P&L (optionally floored at 0).
 * For long positions: quantity * currentPrice.
 * Falls back to stored totalValue when no price is available.
 *
 * @param position  The position to value
 * @param currentPrice  Optional live price
 * @param floor  When true (default), clamp short-position value to >= 0.
 *               Pass false during deserialization to restore exact state.
 */
export function getPositionValue(position: Position, currentPrice?: number, floor = true): number {
  if (position.side === 'short' && position.marginAmount !== undefined) {
    if (currentPrice !== undefined) {
      const raw = new Decimal(position.marginAmount)
        .plus(new Decimal(position.averagePrice).minus(currentPrice).mul(position.quantity))
        .toNumber();
      return floor ? Math.max(0, raw) : raw;
    }
    return position.totalValue;
  }
  return currentPrice !== undefined ? new Decimal(position.quantity).mul(currentPrice).toNumber() : position.totalValue;
}

/**
 * Serialize portfolio for checkpointing
 */
export function serializePortfolio(portfolio: Portfolio): SerializablePortfolio {
  return {
    cashBalance: portfolio.cashBalance,
    positions: Array.from(portfolio.positions.entries()).map(([coinId, pos]) => ({
      coinId,
      quantity: pos.quantity,
      averagePrice: pos.averagePrice,
      ...(pos.entryDate && { entryDate: pos.entryDate.toISOString() }),
      ...(pos.side && { side: pos.side }),
      ...(pos.leverage !== undefined && { leverage: pos.leverage }),
      ...(pos.marginAmount !== undefined && { marginAmount: pos.marginAmount }),
      ...(pos.liquidationPrice !== undefined && { liquidationPrice: pos.liquidationPrice })
    }))
  };
}

/**
 * Deserialize portfolio from checkpoint
 */
export function deserializePortfolio(
  serialized: SerializablePortfolio,
  currentPrices?: Map<string, number>
): Portfolio {
  const positions = new Map<string, Position>();
  let positionsValue = new Decimal(0);
  let totalMarginUsed = new Decimal(0);

  for (const pos of serialized.positions) {
    const price = currentPrices?.get(pos.coinId) ?? pos.averagePrice;
    const tempPosition: Position = {
      coinId: pos.coinId,
      quantity: pos.quantity,
      averagePrice: pos.averagePrice,
      totalValue: 0,
      ...(pos.side && { side: pos.side }),
      ...(pos.marginAmount !== undefined && { marginAmount: pos.marginAmount })
    };
    const totalValue = getPositionValue(tempPosition, price, false);

    if (pos.side === 'short' && pos.marginAmount !== undefined) {
      totalMarginUsed = totalMarginUsed.plus(pos.marginAmount);
    }

    positions.set(pos.coinId, {
      coinId: pos.coinId,
      quantity: pos.quantity,
      averagePrice: pos.averagePrice,
      totalValue,
      ...(pos.entryDate && { entryDate: new Date(pos.entryDate) }),
      ...(pos.side && { side: pos.side }),
      ...(pos.leverage !== undefined && { leverage: pos.leverage }),
      ...(pos.marginAmount !== undefined && { marginAmount: pos.marginAmount }),
      ...(pos.liquidationPrice !== undefined && { liquidationPrice: pos.liquidationPrice })
    });

    positionsValue = positionsValue.plus(totalValue);
  }

  const cashBalance = serialized.cashBalance;
  return {
    cashBalance,
    positions,
    totalValue: new Decimal(cashBalance).plus(positionsValue).toNumber(),
    totalMarginUsed: totalMarginUsed.toNumber(),
    availableMargin: cashBalance
  };
}
