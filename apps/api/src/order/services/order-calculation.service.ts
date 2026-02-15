import { Injectable, Logger } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { toErrorInfo } from '../../shared/error.util';
import { OrderStatus, OrderType } from '../order.entity';

interface OrderInfo {
  [key: string]: unknown;
  fee?: {
    cost: number;
    currency?: string;
  };
  commission?: string | number;
  commissionAsset?: string;
}

@Injectable()
export class OrderCalculationService {
  private readonly logger = new Logger(OrderCalculationService.name);

  /**
   * Calculate the best available price from CCXT order data
   */
  calculateOrderPrice(exchangeOrder: ccxt.Order): number {
    if (exchangeOrder.average && exchangeOrder.average > 0) {
      return exchangeOrder.average;
    }

    if (exchangeOrder.price && exchangeOrder.price > 0) {
      return exchangeOrder.price;
    }

    if (exchangeOrder.cost && exchangeOrder.amount && exchangeOrder.amount > 0) {
      return exchangeOrder.cost / exchangeOrder.amount;
    }

    if (exchangeOrder.info?.price && parseFloat(exchangeOrder.info.price as string) > 0) {
      return parseFloat(exchangeOrder.info.price as string);
    }

    if (exchangeOrder.trades && exchangeOrder.trades.length > 0) {
      return this.calculateWeightedAveragePrice(exchangeOrder.trades);
    }

    // Special case for Binance market orders
    if (this.isBinanceMarketOrder(exchangeOrder)) {
      return this.calculateBinanceMarketPrice(exchangeOrder);
    }

    this.logger.debug(`Could not determine price for order ${exchangeOrder.id}, defaulting to 0`);
    return 0;
  }

  /**
   * Calculate total cost from CCXT order data
   */
  calculateOrderCost(exchangeOrder: ccxt.Order): number {
    if (exchangeOrder.cost && exchangeOrder.cost > 0) {
      return exchangeOrder.cost;
    }

    if (exchangeOrder.filled && exchangeOrder.average && exchangeOrder.filled > 0 && exchangeOrder.average > 0) {
      return exchangeOrder.filled * exchangeOrder.average;
    }

    if (exchangeOrder.amount && exchangeOrder.price && exchangeOrder.amount > 0 && exchangeOrder.price > 0) {
      return exchangeOrder.amount * exchangeOrder.price;
    }

    // Check for cumulative quote quantity (Binance specific)
    if (exchangeOrder.info?.cummulativeQuoteQty) {
      const quoteQty = parseFloat(exchangeOrder.info.cummulativeQuoteQty as string);
      if (!isNaN(quoteQty) && quoteQty > 0) {
        return quoteQty;
      }
    }

    if (exchangeOrder.trades && exchangeOrder.trades.length > 0) {
      return this.calculateTotalCostFromTrades(exchangeOrder.trades);
    }

    // Last resort - calculate from available data
    const price = this.calculateOrderPrice(exchangeOrder);
    const amount = exchangeOrder.filled || exchangeOrder.amount || 0;

    if (price > 0 && amount > 0) {
      return price * amount;
    }

    this.logger.debug(`Could not determine cost for order ${exchangeOrder.id}, defaulting to 0`);
    return 0;
  }

  /**
   * Extract fee information from CCXT order
   */
  extractFeeData(exchangeOrder: ccxt.Order): { fee: number; commission: number; feeCurrency?: string } {
    let fee = 0;
    let commission = 0;
    let feeCurrency: string | undefined;

    // Extract from order fee object
    if (exchangeOrder.fee && exchangeOrder.fee.cost) {
      fee = exchangeOrder.fee.cost;
      feeCurrency = exchangeOrder.fee.currency;
    }

    // Extract from trades
    if (exchangeOrder.trades && exchangeOrder.trades.length > 0) {
      const tradesFeeData = this.extractFeesFromTrades(exchangeOrder.trades);
      fee = Math.max(fee, tradesFeeData.totalFee);
      commission = Math.max(commission, tradesFeeData.totalCommission);
      feeCurrency = feeCurrency || tradesFeeData.feeCurrency;
    }

    // Extract from order info (exchange-specific)
    if (exchangeOrder.info) {
      const infoFeeData = this.extractFeeFromOrderInfo(exchangeOrder.info);
      if (infoFeeData.fee > 0) {
        fee = Math.max(fee, infoFeeData.fee);
        commission = Math.max(commission, infoFeeData.commission);
        feeCurrency = feeCurrency || infoFeeData.feeCurrency;
      }
    }

    return { fee, commission, feeCurrency };
  }

  /**
   * Calculate gain/loss for an order
   */
  calculateGainLoss(exchangeOrder: ccxt.Order, feeData: { fee: number; commission: number }): number | null {
    // Basic implementation - can be enhanced with more sophisticated logic
    if (exchangeOrder.side === 'sell' && exchangeOrder.cost && feeData.fee) {
      return exchangeOrder.cost - feeData.fee;
    }
    return null;
  }

  /**
   * Map CCXT order status to our OrderStatus enum
   */
  mapCcxtStatusToOrderStatus(ccxtStatus: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      open: OrderStatus.NEW,
      closed: OrderStatus.FILLED,
      canceled: OrderStatus.CANCELED,
      expired: OrderStatus.EXPIRED,
      rejected: OrderStatus.REJECTED
    };

    return statusMap[ccxtStatus] || OrderStatus.NEW;
  }

  /**
   * Map CCXT order type to our OrderType enum
   */
  mapCcxtOrderTypeToOrderType(ccxtType: string): OrderType {
    const typeMap: Record<string, OrderType> = {
      limit: OrderType.LIMIT,
      market: OrderType.MARKET,
      stop: OrderType.STOP_LOSS,
      stop_loss: OrderType.STOP_LOSS,
      stop_limit: OrderType.STOP_LIMIT,
      stop_loss_limit: OrderType.STOP_LIMIT,
      take_profit: OrderType.TAKE_PROFIT,
      take_profit_limit: OrderType.TAKE_PROFIT,
      trailing_stop: OrderType.TRAILING_STOP
    };

    return typeMap[ccxtType?.toLowerCase()] || OrderType.MARKET;
  }

  /**
   * Extract coin symbols from market symbol
   */
  extractCoinSymbol(marketSymbol: string): { base: string; quote: string } {
    try {
      if (marketSymbol.includes('/')) {
        const [base, quote] = marketSymbol.split('/');
        return { base: base.toUpperCase(), quote: quote.toUpperCase() };
      }

      // Handle concatenated symbols like "BTCUSDT"
      const match = marketSymbol.match(/^([A-Z0-9]{3,})([A-Z0-9]{3,})$/);
      if (match) {
        return { base: match[1].toUpperCase(), quote: match[2].toUpperCase() };
      }

      return { base: marketSymbol.toUpperCase(), quote: '' };
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to extract coin symbols from ${marketSymbol}: ${err.message}`);
      return { base: marketSymbol.toUpperCase(), quote: '' };
    }
  }

  private calculateWeightedAveragePrice(trades: ccxt.Trade[]): number {
    let totalValue = 0;
    let totalAmount = 0;

    for (const trade of trades) {
      if (trade.amount && trade.price) {
        totalValue += trade.amount * trade.price;
        totalAmount += trade.amount;
      }
    }

    return totalAmount > 0 ? totalValue / totalAmount : 0;
  }

  private calculateTotalCostFromTrades(trades: ccxt.Trade[]): number {
    return trades.reduce((total, trade) => {
      if (trade.amount && trade.price) {
        return total + trade.amount * trade.price;
      }
      return total;
    }, 0);
  }

  private extractFeesFromTrades(trades: ccxt.Trade[]): {
    totalFee: number;
    totalCommission: number;
    feeCurrency?: string;
  } {
    let totalFee = 0;
    const totalCommission = 0;
    let feeCurrency: string | undefined;

    for (const trade of trades) {
      if (trade.fee) {
        totalFee += trade.fee.cost || 0;
        feeCurrency = feeCurrency || trade.fee.currency;
      }
    }

    return { totalFee, totalCommission, feeCurrency };
  }

  private extractFeeFromOrderInfo(info: OrderInfo): { fee: number; commission: number; feeCurrency?: string } {
    let fee = 0;
    let commission = 0;
    let feeCurrency: string | undefined;

    if (info.commission && !isNaN(Number(info.commission))) {
      commission = Number(info.commission);
      feeCurrency = info.commissionAsset;
    }

    // Handle Binance fills array
    if (info.fills && Array.isArray(info.fills)) {
      for (const fill of info.fills) {
        if (fill.commission) {
          commission += parseFloat(fill.commission);
          feeCurrency = feeCurrency || fill.commissionAsset;
        }
      }
      fee = Math.max(fee, commission);
    }

    return { fee, commission, feeCurrency };
  }

  private isBinanceMarketOrder(exchangeOrder: ccxt.Order): boolean {
    return (
      exchangeOrder.type === 'market' && exchangeOrder.info?.cummulativeQuoteQty && exchangeOrder.info?.executedQty
    );
  }

  private calculateBinanceMarketPrice(exchangeOrder: ccxt.Order): number {
    const quoteQty = parseFloat(exchangeOrder.info.cummulativeQuoteQty as string);
    const execQty = parseFloat(exchangeOrder.info.executedQty as string);

    if (quoteQty > 0 && execQty > 0) {
      this.logger.debug(`Calculated price for market order ${exchangeOrder.id}: ${quoteQty / execQty}`);
      return quoteQty / execQty;
    }

    return 0;
  }
}
