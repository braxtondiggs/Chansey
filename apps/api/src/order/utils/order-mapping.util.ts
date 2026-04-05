import * as ccxt from 'ccxt';

import { Order } from '../order.entity';

/**
 * Convert CCXT Trade objects to CCXT Order objects.
 * Groups trades by order ID (or symbol+timestamp+side) and aggregates values.
 * Returns the synthetic orders and the count of original trades for logging.
 */
export function convertTradesToOrders(trades: ccxt.Trade[]): { orders: ccxt.Order[]; tradeCount: number } {
  const tradeGroups = new Map<string, ccxt.Trade[]>();

  for (const trade of trades) {
    const groupKey = trade.order || `${trade.symbol}_${trade.timestamp}_${trade.side}`;
    const existing = tradeGroups.get(groupKey);
    if (existing) {
      existing.push(trade);
    } else {
      tradeGroups.set(groupKey, [trade]);
    }
  }

  const orders: ccxt.Order[] = [];

  for (const [groupKey, groupTrades] of tradeGroups) {
    const firstTrade = groupTrades[0];

    const totalAmount = groupTrades.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalCost = groupTrades.reduce((sum, t) => sum + (t.cost || 0), 0);
    const weightedPrice = totalCost > 0 && totalAmount > 0 ? totalCost / totalAmount : firstTrade.price || 0;

    const syntheticOrder: ccxt.Order = {
      id: firstTrade.order || `trade_${groupKey}`,
      clientOrderId: firstTrade.order || undefined,
      datetime: firstTrade.datetime ?? new Date(firstTrade.timestamp ?? 0).toISOString(),
      timestamp: firstTrade.timestamp ?? 0,
      lastTradeTimestamp: Math.max(...groupTrades.map((t) => t.timestamp ?? 0)),
      symbol: firstTrade.symbol ?? '',
      type: 'market',
      timeInForce: undefined,
      amount: totalAmount,
      price: weightedPrice,
      average: weightedPrice,
      filled: totalAmount,
      remaining: 0,
      cost: totalCost,
      side: firstTrade.side,
      status: 'closed',
      postOnly: false,
      reduceOnly: false,
      fee: groupTrades.reduce<ccxt.FeeInterface>(
        (sum, t) => {
          if (t.fee) {
            return {
              cost: (Number(sum.cost) || 0) + (Number(t.fee.cost) || 0),
              currency: t.fee.currency ?? sum.currency
            };
          }
          return sum;
        },
        { cost: 0, currency: undefined }
      ),
      trades: groupTrades,
      info: {
        ...firstTrade.info,
        synthetic: true,
        tradeIds: groupTrades.map((t) => t.id).join(',')
      }
    };

    orders.push(syntheticOrder);
  }

  return { orders, tradeCount: trades.length };
}

/**
 * Extract algorithmic trading fields from a CCXT order into partial Order data.
 */
export function extractAlgorithmicTradingFields(exchangeOrder: ccxt.Order): Partial<Order> {
  const fields: Partial<Order> = {};

  if (exchangeOrder.timeInForce) {
    fields.timeInForce = exchangeOrder.timeInForce as string;
  }

  if (exchangeOrder.stopPrice && exchangeOrder.stopPrice > 0) {
    fields.stopPrice = exchangeOrder.stopPrice;
  }

  if (exchangeOrder.remaining !== undefined && exchangeOrder.remaining !== null) {
    fields.remaining = exchangeOrder.remaining;
  } else if (exchangeOrder.amount && exchangeOrder.filled) {
    fields.remaining = exchangeOrder.amount - exchangeOrder.filled;
  }

  if (exchangeOrder.postOnly !== undefined) {
    fields.postOnly = exchangeOrder.postOnly;
  }

  if (exchangeOrder.reduceOnly !== undefined) {
    fields.reduceOnly = exchangeOrder.reduceOnly;
  }

  if (exchangeOrder.info && typeof exchangeOrder.info === 'object') {
    const info = exchangeOrder.info as Record<string, string | number>;

    const trigger = Number(info.triggerPrice);
    if (trigger > 0) {
      fields.triggerPrice = trigger;
    }

    const takeProfit = Number(info.takeProfitPrice);
    if (takeProfit > 0) {
      fields.takeProfitPrice = takeProfit;
    }

    const stopLoss = Number(info.stopLossPrice);
    if (stopLoss > 0) {
      fields.stopLossPrice = stopLoss;
    }

    if (info.updateTime) {
      fields.lastUpdateTimestamp = new Date(Number(info.updateTime));
    }
  }

  if (exchangeOrder.trades && exchangeOrder.trades.length > 0) {
    fields.trades = exchangeOrder.trades.map((trade) => ({
      id: String(trade.id ?? ''),
      timestamp: Number(trade.timestamp ?? 0),
      amount: Number(trade.amount ?? 0),
      price: trade.price,
      cost: Number(trade.cost ?? 0),
      side: String(trade.side ?? ''),
      fee: trade.fee ? { cost: Number(trade.fee.cost ?? 0), currency: String(trade.fee.currency ?? '') } : undefined,
      takerOrMaker: trade.takerOrMaker ?? undefined
    }));

    const lastTrade = exchangeOrder.trades[exchangeOrder.trades.length - 1];
    if (lastTrade.timestamp) {
      fields.lastTradeTimestamp = new Date(lastTrade.timestamp);
    }
  }

  if (exchangeOrder.info && typeof exchangeOrder.info === 'object') {
    const cleanInfo = { ...exchangeOrder.info };
    delete cleanInfo.fills;
    fields.info = cleanInfo;
  }

  return fields;
}

/**
 * Extract futures-specific fields from a CCXT order.
 * Detects whether an order is a futures/swap order and populates margin, leverage, and liquidation data.
 */
export function extractFuturesFields(exchangeOrder: ccxt.Order): Partial<Order> {
  const info = exchangeOrder.info as Record<string, string | number | undefined> | undefined;
  const orderType = String(exchangeOrder.type ?? '');

  const isFutures =
    info?.marginMode !== undefined ||
    orderType === 'swap' ||
    orderType === 'future' ||
    info?.marginType !== undefined ||
    (typeof exchangeOrder.symbol === 'string' && exchangeOrder.symbol.includes(':'));

  if (isFutures) {
    return {
      marketType: 'futures',
      positionSide: info?.positionSide != null ? String(info.positionSide).toLowerCase() : undefined,
      leverage: info?.leverage != null ? Number(info.leverage) : undefined,
      liquidationPrice: info?.liquidationPrice != null ? Number(info.liquidationPrice) : undefined,
      marginAmount: info?.initialMargin != null ? Number(info.initialMargin) : undefined,
      marginMode: info?.marginMode != null ? String(info.marginMode).toLowerCase() : undefined
    };
  }

  return { marketType: 'spot' };
}
