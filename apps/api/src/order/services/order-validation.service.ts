import { Injectable } from '@nestjs/common';

import * as ccxt from 'ccxt';

import {
  InvalidSymbolException,
  OrderSizeException,
  TradingSuspendedException,
  ValidationException
} from '../../common/exceptions';
import { OrderDto } from '../dto/order.dto';
import { OrderType } from '../order.entity';

interface SymbolPriceFilter {
  filterType: string;
  minPrice: string;
  maxPrice: string;
  tickSize: string;
}

interface SymbolLotSizeFilter {
  filterType: string;
  minQty: string;
  maxQty: string;
  stepSize: string;
}

interface SymbolMinNotionalFilter {
  filterType: string;
  minNotional: string;
}

interface SymbolInfo {
  symbol: string;
  status: string;
  permissions?: string[];
  quotePrecision: number | string;
  filters: Array<{
    filterType: string;
    [key: string]: string | number | boolean;
  }>;
}

interface SymbolValidationFilters {
  priceFilter: SymbolPriceFilter;
  lotSizeFilter: SymbolLotSizeFilter;
  minNotionalFilter: SymbolMinNotionalFilter;
}

@Injectable()
export class OrderValidationService {
  /**
   * Transform CCXT market info into Binance-compatible format
   */
  transformMarketToSymbolInfo(market: ccxt.Market) {
    return {
      symbol: market.id,
      status: market.active ? 'TRADING' : 'BREAK',
      permissions: market.active ? ['SPOT'] : [],
      quotePrecision: market.precision.price,
      filters: [
        {
          filterType: 'PRICE_FILTER',
          minPrice: market.limits.price?.min?.toString() || '0',
          maxPrice: market.limits.price?.max?.toString() || '1000000',
          tickSize: market.precision.price?.toString() || '0.00000001'
        },
        {
          filterType: 'LOT_SIZE',
          minQty: market.limits.amount?.min?.toString() || '0.00000100',
          maxQty: market.limits.amount?.max?.toString() || '9000000',
          stepSize: market.precision.amount?.toString() || '0.00000001'
        },
        {
          filterType: 'MIN_NOTIONAL',
          minNotional: market.limits.cost?.min?.toString() || '10'
        }
      ]
    };
  }

  /**
   * Extract validation filters from symbol info
   */
  getSymbolFilters(
    filters: { filterType: string; [key: string]: string | number | boolean }[]
  ): SymbolValidationFilters {
    const priceFilterObj = filters.find((f) => f.filterType === 'PRICE_FILTER');
    const lotSizeFilterObj = filters.find((f) => f.filterType === 'LOT_SIZE');
    const minNotionalFilterObj = filters.find((f) => f.filterType === 'MIN_NOTIONAL');

    const priceFilter: SymbolPriceFilter = {
      filterType: 'PRICE_FILTER',
      minPrice: priceFilterObj?.minPrice?.toString() || '0',
      maxPrice: priceFilterObj?.maxPrice?.toString() || '1000000',
      tickSize: priceFilterObj?.tickSize?.toString() || '0.00000001'
    };

    const lotSizeFilter: SymbolLotSizeFilter = {
      filterType: 'LOT_SIZE',
      minQty: lotSizeFilterObj?.minQty?.toString() || '0.00000100',
      maxQty: lotSizeFilterObj?.maxQty?.toString() || '9000000',
      stepSize: lotSizeFilterObj?.stepSize?.toString() || '0.00000001'
    };

    const minNotionalFilter: SymbolMinNotionalFilter = {
      filterType: 'MIN_NOTIONAL',
      minNotional: minNotionalFilterObj?.minNotional?.toString() || '10'
    };

    return { priceFilter, lotSizeFilter, minNotionalFilter };
  }

  /**
   * Validate symbol trading status
   */
  validateSymbolStatus(symbol: { status: string; permissions?: string[] }): void {
    if (symbol.status !== 'TRADING') {
      throw new TradingSuspendedException();
    }
    if (!symbol.permissions?.includes('SPOT')) {
      throw new ValidationException('Spot trading is not available for this symbol');
    }
  }

  /**
   * Validate price against symbol filters
   */
  validatePrice(price: number, filters: SymbolValidationFilters): void {
    const { minPrice, maxPrice, tickSize } = filters.priceFilter;
    const minPriceFloat = parseFloat(minPrice);
    const maxPriceFloat = parseFloat(maxPrice);

    if (price < minPriceFloat) {
      throw new OrderSizeException('min', price, minPriceFloat, 'price');
    }
    if (price > maxPriceFloat) {
      throw new OrderSizeException('max', price, maxPriceFloat, 'price');
    }
    if (!this.isValidTickSize(price, tickSize)) {
      throw new ValidationException(`Price ${price} does not match tick size ${tickSize}`);
    }
  }

  /**
   * Validate and adjust quantity to meet exchange requirements
   */
  validateAndAdjustQuantity(quantity: number, filters: SymbolValidationFilters, precision: number): string {
    const { minQty, maxQty, stepSize } = filters.lotSizeFilter;
    const minQtyFloat = parseFloat(minQty);
    const maxQtyFloat = parseFloat(maxQty);

    const maxValidQuantity = this.calculateMaxQuantity(quantity, stepSize);

    if (maxValidQuantity < minQtyFloat) {
      throw new OrderSizeException('min', maxValidQuantity, minQtyFloat, 'quantity');
    }
    if (maxValidQuantity > maxQtyFloat) {
      throw new OrderSizeException('max', maxValidQuantity, maxQtyFloat, 'quantity');
    }

    return maxValidQuantity.toFixed(precision);
  }

  /**
   * Validate order with exchange requirements
   */
  async validateOrder(orderDto: OrderDto, symbol: string, exchange: any): Promise<void> {
    // Get market info from exchange
    const markets = await exchange.fetchMarkets();
    const market = markets.find((m: any) => m.symbol === symbol);

    if (!market) {
      throw new InvalidSymbolException(symbol);
    }

    if (!market.active) {
      throw new TradingSuspendedException(symbol);
    }

    const quantity = parseFloat(orderDto.quantity);

    // Validate quantity limits
    if (market.limits?.amount?.min && quantity < market.limits.amount.min) {
      throw new OrderSizeException('min', quantity, market.limits.amount.min, 'quantity');
    }

    if (market.limits?.amount?.max && quantity > market.limits.amount.max) {
      throw new OrderSizeException('max', quantity, market.limits.amount.max, 'quantity');
    }

    // Validate price for limit orders
    if (orderDto.price) {
      const price = parseFloat(orderDto.price);

      if (market.limits?.price?.min && price < market.limits.price.min) {
        throw new OrderSizeException('min', price, market.limits.price.min, 'price');
      }

      if (market.limits?.price?.max && price > market.limits.price.max) {
        throw new OrderSizeException('max', price, market.limits.price.max, 'price');
      }

      // Check minimum notional value
      const notional = quantity * price;
      if (market.limits?.cost?.min && notional < market.limits.cost.min) {
        throw new OrderSizeException('min', notional, market.limits.cost.min, 'order value');
      }
    }
  }

  /**
   * Validate exchange requirements for an order
   */
  async validateExchangeOrder(order: OrderDto, orderType: OrderType, symbolInfo: SymbolInfo): Promise<OrderDto> {
    this.validateSymbolStatus(symbolInfo);

    const filters = this.getSymbolFilters(symbolInfo.filters);
    const quantity = parseFloat(order.quantity);

    if (orderType === OrderType.LIMIT && order.price) {
      const price = parseFloat(order.price);
      this.validatePrice(price, filters);

      const minNotional = parseFloat(filters.minNotionalFilter.minNotional);
      const notionalValue = quantity * price;
      if (notionalValue < minNotional) {
        throw new OrderSizeException('min', notionalValue, minNotional, 'order value');
      }
    }

    const quotePrecision =
      typeof symbolInfo.quotePrecision === 'number'
        ? symbolInfo.quotePrecision
        : parseInt(symbolInfo.quotePrecision as string, 10);

    order.quantity = this.validateAndAdjustQuantity(quantity, filters, quotePrecision);
    return order;
  }

  private isValidTickSize(price: number, tickSize: string): boolean {
    const precision = this.getPrecisionFromStepSize(tickSize);
    const multiplier = Math.pow(10, precision);
    const tickSizeFloat = parseFloat(tickSize);
    return Math.abs((price * multiplier) % (tickSizeFloat * multiplier)) < Number.EPSILON;
  }

  private calculateMaxQuantity(quantity: number, stepSize: string): number {
    const precision = this.getPrecisionFromStepSize(stepSize);
    const step = parseFloat(stepSize);
    const maxSteps = Math.floor(quantity / step);
    return Number((maxSteps * step).toFixed(precision));
  }

  private getPrecisionFromStepSize(stepSize: string): number {
    return stepSize.split('.')[1]?.length || 0;
  }
}
