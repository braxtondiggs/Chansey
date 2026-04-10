import {
  type ExitConfigRequest,
  ExitTrailingType,
  OrderSide,
  OrderType,
  StopLossType,
  TakeProfitType,
  TimeInForce,
  TrailingActivationType,
  TrailingType
} from '@chansey/api-interfaces';

import { buildOrderRequest, calculatePositionSize, calculateSlippage, calculateSpread } from './trading-utils';

describe('calculateSpread', () => {
  it.each([
    [100, 102, 2],
    [50, 50, 0],
    [102, 100, -1.9608]
  ])('calculateSpread(%d, %d) ≈ %d', (bid, ask, expected) => {
    expect(calculateSpread(bid, ask)).toBeCloseTo(expected, 4);
  });
});

describe('calculateSlippage', () => {
  it.each([
    [100, 101, 1, 'price increase'],
    [100, 99, 1, 'price decrease'],
    [100, 100, 0, 'matching prices']
  ])('returns positive slippage for %s', (expected, actual, result) => {
    expect(calculateSlippage(expected, actual)).toBeCloseTo(result);
  });
});

describe('calculatePositionSize', () => {
  it('uses entry price when no stop loss', () => {
    // riskAmount = 10000 * (2/100) = 200; result = 200 / 50000 = 0.004
    expect(calculatePositionSize(10000, 2, 50000)).toBe(0.004);
  });

  it('uses risk-per-unit when stop loss below entry', () => {
    // riskAmount = 200; riskPerUnit = |50000 - 49000| = 1000; result = 200 / 1000 = 0.2
    expect(calculatePositionSize(10000, 2, 50000, 49000)).toBe(0.2);
  });

  it('uses risk-per-unit when stop loss above entry (short)', () => {
    // riskPerUnit = |100 - 110| = 10; riskAmount = 50; result = 50 / 10 = 5
    expect(calculatePositionSize(1000, 5, 100, 110)).toBe(5);
  });

  it('falls through to entry-price path when stopLoss is 0 (falsy)', () => {
    // stopLoss = 0 is falsy, so falls to riskAmount / entryPrice
    // riskAmount = 10000 * (2/100) = 200; result = 200 / 50000 = 0.004
    expect(calculatePositionSize(10000, 2, 50000, 0)).toBe(0.004);
  });
});

describe('buildOrderRequest', () => {
  it('builds a basic market order without optional fields', () => {
    const result = buildOrderRequest('key-1', 'BTC/USDT', OrderSide.BUY, OrderType.MARKET, 0.5);
    expect(result).toEqual({
      exchangeKeyId: 'key-1',
      symbol: 'BTC/USDT',
      side: OrderSide.BUY,
      orderType: OrderType.MARKET,
      quantity: 0.5
    });
    expect(result).not.toHaveProperty('stopPrice');
    expect(result).not.toHaveProperty('trailingAmount');
  });

  it('includes all optional fields when provided', () => {
    const result = buildOrderRequest('key-1', 'BTC/USDT', OrderSide.BUY, OrderType.TRAILING_STOP, 1, {
      price: 50000,
      stopPrice: 49000,
      trailingAmount: 100,
      trailingType: TrailingType.AMOUNT,
      takeProfitPrice: 55000,
      stopLossPrice: 48000,
      timeInForce: TimeInForce.GTC
    });

    expect(result).toEqual(
      expect.objectContaining({
        price: 50000,
        stopPrice: 49000,
        trailingAmount: 100,
        trailingType: TrailingType.AMOUNT,
        takeProfitPrice: 55000,
        stopLossPrice: 48000,
        timeInForce: TimeInForce.GTC
      })
    );
  });

  it('excludes null options from the request', () => {
    const result = buildOrderRequest('key-1', 'BTC/USDT', OrderSide.BUY, OrderType.LIMIT, 1, {
      price: null as unknown as number,
      stopPrice: null as unknown as number,
      trailingAmount: null as unknown as number,
      timeInForce: null as unknown as TimeInForce
    });
    expect(result).not.toHaveProperty('price');
    expect(result).not.toHaveProperty('stopPrice');
    expect(result).not.toHaveProperty('trailingAmount');
    expect(result).not.toHaveProperty('timeInForce');
  });

  it('includes option fields with falsy value 0 (not undefined)', () => {
    const result = buildOrderRequest('key-1', 'BTC/USDT', OrderSide.SELL, OrderType.LIMIT, 1, {
      price: 0,
      stopPrice: 0
    });
    expect(result.price).toBe(0);
    expect(result.stopPrice).toBe(0);
  });

  it('includes exitConfig when provided', () => {
    const exitConfig: ExitConfigRequest = {
      enableStopLoss: true,
      stopLossType: StopLossType.PERCENTAGE,
      stopLossValue: 2.0,
      enableTakeProfit: true,
      takeProfitType: TakeProfitType.PERCENTAGE,
      takeProfitValue: 5.0,
      enableTrailingStop: false,
      trailingType: ExitTrailingType.PERCENTAGE,
      trailingValue: 1.0,
      trailingActivation: TrailingActivationType.IMMEDIATE,
      useOco: true
    };
    const result = buildOrderRequest('key-1', 'BTC/USDT', OrderSide.BUY, OrderType.MARKET, 0.5, { exitConfig });
    expect(result.exitConfig).toEqual(exitConfig);
  });

  it('omits exitConfig when undefined', () => {
    const result = buildOrderRequest('key-1', 'BTC/USDT', OrderSide.BUY, OrderType.MARKET, 0.5, {
      exitConfig: undefined
    });
    expect(result).not.toHaveProperty('exitConfig');
  });
});
