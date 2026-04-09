import { BadRequestException, Injectable } from '@nestjs/common';

import * as ccxt from 'ccxt';

import { getExchangeOrderTypeSupport, getSupportedOrderTypes, isOrderTypeSupported } from '@chansey/api-interfaces';

import { PlaceManualOrderDto } from '../dto/place-manual-order.dto';
import { OrderSide, OrderType } from '../order.entity';

/**
 * Validates manual order parameters and requirements against exchange/market/balances.
 * Stateless — no DI dependencies.
 */
@Injectable()
export class ManualOrderValidatorService {
  /**
   * Assert that the given order type is supported on the exchange.
   * Shared by `previewManualOrder` and `validate()` so the check lives in one place.
   */
  assertOrderTypeSupported(exchangeSlug: string, orderType: OrderType, exchangeName?: string): void {
    if (!isOrderTypeSupported(exchangeSlug, orderType)) {
      const supportedTypes = getSupportedOrderTypes(exchangeSlug);
      const target = exchangeName ?? 'this exchange';
      throw new BadRequestException(
        `Order type "${orderType}" is not supported on ${target}. Supported types: ${supportedTypes.join(', ')}`
      );
    }
  }

  async validate(dto: PlaceManualOrderDto, exchange: ccxt.Exchange, exchangeSlug: string): Promise<void> {
    this.assertOrderTypeSupported(exchangeSlug, dto.orderType, exchange.name || exchangeSlug);

    if (!exchange.markets || !exchange.markets[dto.symbol]) {
      throw new BadRequestException(`Trading pair ${dto.symbol} is not available on this exchange`);
    }

    const market = exchange.markets[dto.symbol];

    if (market.limits?.amount) {
      if (market.limits.amount.min && dto.quantity < market.limits.amount.min) {
        throw new BadRequestException(
          `Order quantity ${dto.quantity} is below minimum ${market.limits.amount.min} for ${dto.symbol}`
        );
      }
      if (market.limits.amount.max && dto.quantity > market.limits.amount.max) {
        throw new BadRequestException(
          `Order quantity ${dto.quantity} exceeds maximum ${market.limits.amount.max} for ${dto.symbol}`
        );
      }
    }

    if ((dto.orderType === OrderType.LIMIT || dto.orderType === OrderType.STOP_LIMIT) && !dto.price) {
      throw new BadRequestException(`Price is required for ${dto.orderType} orders`);
    }

    if ((dto.orderType === OrderType.STOP_LOSS || dto.orderType === OrderType.STOP_LIMIT) && !dto.stopPrice) {
      throw new BadRequestException(`Stop price is required for ${dto.orderType} orders`);
    }

    if (dto.orderType === OrderType.TRAILING_STOP) {
      const support = getExchangeOrderTypeSupport(exchangeSlug);
      if (!support.hasTrailingStopSupport) {
        throw new BadRequestException(`Trailing stop orders are not supported on this exchange`);
      }
      if (!dto.trailingAmount) {
        throw new BadRequestException('Trailing amount is required for trailing stop orders');
      }
      if (!dto.trailingType) {
        throw new BadRequestException('Trailing type is required for trailing stop orders');
      }
    }

    if (dto.orderType === OrderType.OCO) {
      const support = getExchangeOrderTypeSupport(exchangeSlug);
      if (!support.hasOcoSupport) {
        throw new BadRequestException(`OCO orders are not supported on this exchange`);
      }
      if (!dto.takeProfitPrice) {
        throw new BadRequestException('Take profit price is required for OCO orders');
      }
      if (!dto.stopLossPrice) {
        throw new BadRequestException('Stop loss price is required for OCO orders');
      }
    }

    const balances = await exchange.fetchBalance();
    const [baseCurrency, quoteCurrency] = dto.symbol.split('/');

    if (dto.side === OrderSide.BUY) {
      const availableQuote = balances[quoteCurrency]?.free || 0;
      const ticker = await exchange.fetchTicker(dto.symbol);
      const price = dto.price || ticker.last || ticker.close || 0;
      if (price <= 0) {
        throw new BadRequestException(`Could not determine market price for ${dto.symbol}`);
      }
      const cost = dto.quantity * price;

      const isMaker = dto.orderType === OrderType.LIMIT;
      const feeRate = isMaker ? market?.maker || 0.001 : market?.taker || 0.001;
      const totalRequired = cost * (1 + feeRate);

      if (availableQuote < totalRequired) {
        throw new BadRequestException(
          `Insufficient ${quoteCurrency} balance. Available: ${availableQuote.toFixed(8)}, Required: ${totalRequired.toFixed(8)} (including ${(feeRate * 100).toFixed(2)}% fee)`
        );
      }
    } else {
      const availableBase = balances[baseCurrency]?.free || 0;
      if (availableBase < dto.quantity) {
        throw new BadRequestException(
          `Insufficient ${baseCurrency} balance. Available: ${availableBase.toFixed(8)}, Required: ${dto.quantity.toFixed(8)}`
        );
      }
    }
  }
}
