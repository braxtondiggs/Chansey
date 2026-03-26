import { ExchangeOrderTypeSupport, OrderType, TimeInForce } from './order.interface';

/** Shared config for Binance US variants */
const BINANCE_US_CONFIG = {
  supportedTypes: [
    OrderType.MARKET,
    OrderType.LIMIT,
    OrderType.STOP_LOSS,
    OrderType.STOP_LIMIT,
    OrderType.TAKE_PROFIT,
    OrderType.OCO
  ],
  supportedTimeInForce: [TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK],
  hasOcoSupport: true,
  hasTrailingStopSupport: false
};

/** Shared config for Coinbase Pro variants (coinbasepro, gdax, coinbaseexchange) */
const COINBASE_PRO_CONFIG = {
  supportedTypes: [OrderType.MARKET, OrderType.LIMIT, OrderType.STOP_LOSS],
  supportedTimeInForce: [TimeInForce.GTC, TimeInForce.IOC],
  hasOcoSupport: false,
  hasTrailingStopSupport: false
};

/**
 * Exchange-specific order type support configuration
 * This is the single source of truth for what order types each exchange supports
 */
export const EXCHANGE_ORDER_TYPE_SUPPORT: Record<string, ExchangeOrderTypeSupport> = {
  binanceus: { exchangeSlug: 'binanceus', ...BINANCE_US_CONFIG },
  binance_us: { exchangeSlug: 'binance_us', ...BINANCE_US_CONFIG },
  binance: {
    exchangeSlug: 'binance',
    supportedTypes: [
      OrderType.MARKET,
      OrderType.LIMIT,
      OrderType.STOP_LOSS,
      OrderType.STOP_LIMIT,
      OrderType.TRAILING_STOP,
      OrderType.TAKE_PROFIT,
      OrderType.OCO
    ],
    supportedTimeInForce: [TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK],
    hasOcoSupport: true,
    hasTrailingStopSupport: true
  },
  coinbase: { exchangeSlug: 'coinbase', ...COINBASE_PRO_CONFIG },
  coinbasepro: { exchangeSlug: 'coinbasepro', ...COINBASE_PRO_CONFIG },
  gdax: { exchangeSlug: 'gdax', ...COINBASE_PRO_CONFIG },
  coinbaseexchange: { exchangeSlug: 'coinbaseexchange', ...COINBASE_PRO_CONFIG },
  kraken: {
    exchangeSlug: 'kraken',
    supportedTypes: [
      OrderType.MARKET,
      OrderType.LIMIT,
      OrderType.STOP_LOSS,
      OrderType.STOP_LIMIT,
      OrderType.TAKE_PROFIT
    ],
    supportedTimeInForce: [TimeInForce.GTC, TimeInForce.IOC],
    hasOcoSupport: false,
    hasTrailingStopSupport: false
  },
  kucoin: {
    exchangeSlug: 'kucoin',
    supportedTypes: [
      OrderType.MARKET,
      OrderType.LIMIT,
      OrderType.STOP_LOSS,
      OrderType.STOP_LIMIT,
      OrderType.TRAILING_STOP
    ],
    supportedTimeInForce: [TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK],
    hasOcoSupport: false,
    hasTrailingStopSupport: true
  },
  okx: {
    exchangeSlug: 'okx',
    supportedTypes: [
      OrderType.MARKET,
      OrderType.LIMIT,
      OrderType.STOP_LOSS,
      OrderType.STOP_LIMIT,
      OrderType.TRAILING_STOP,
      OrderType.TAKE_PROFIT
    ],
    supportedTimeInForce: [TimeInForce.GTC, TimeInForce.IOC, TimeInForce.FOK],
    hasOcoSupport: false,
    hasTrailingStopSupport: true
  }
};

/**
 * Default order type support for unknown exchanges
 */
export const DEFAULT_ORDER_TYPE_SUPPORT: ExchangeOrderTypeSupport = {
  exchangeSlug: 'default',
  supportedTypes: [OrderType.MARKET, OrderType.LIMIT],
  supportedTimeInForce: [TimeInForce.GTC],
  hasOcoSupport: false,
  hasTrailingStopSupport: false
};

/**
 * Get the order type support for a specific exchange
 */
export function getExchangeOrderTypeSupport(exchangeSlug: string): ExchangeOrderTypeSupport {
  return EXCHANGE_ORDER_TYPE_SUPPORT[exchangeSlug] || DEFAULT_ORDER_TYPE_SUPPORT;
}

/**
 * Check if an exchange supports a specific order type
 */
export function isOrderTypeSupported(exchangeSlug: string, orderType: OrderType): boolean {
  const support = getExchangeOrderTypeSupport(exchangeSlug);
  return support.supportedTypes.includes(orderType);
}

/**
 * Get the supported order types for a specific exchange
 */
export function getSupportedOrderTypes(exchangeSlug: string): OrderType[] {
  return getExchangeOrderTypeSupport(exchangeSlug).supportedTypes;
}
