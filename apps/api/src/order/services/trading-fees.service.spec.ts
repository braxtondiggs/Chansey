import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { TradingFeesService } from './trading-fees.service';

import { OrderSide, OrderType } from '../order.entity';

describe('TradingFeesService', () => {
  let service: TradingFeesService;

  beforeEach(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'debug').mockImplementation();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TradingFeesService]
    }).compile();

    service = module.get<TradingFeesService>(TradingFeesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getTradingFees', () => {
    it('uses API fees when available (taker for MARKET)', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockResolvedValue({ maker: 0.001, taker: 0.002 })
      };

      const { feeRate, feeAmount } = await service.getTradingFees(exchangeStub, 'binance', OrderType.MARKET, 1000);

      expect(feeRate).toBe(0.002);
      expect(feeAmount).toBe(2);
    });

    it('uses API fees when available (maker for LIMIT)', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockResolvedValue({ maker: 0.001, taker: 0.002 })
      };

      const { feeRate } = await service.getTradingFees(exchangeStub, 'binance', OrderType.LIMIT, 1000);
      expect(feeRate).toBe(0.001);
    });

    it('reads symbol-keyed fees from Kraken-shaped response', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockResolvedValue({
          'BTC/USD': { symbol: 'BTC/USD', maker: 0.0016, taker: 0.0026 },
          'ETH/USD': { symbol: 'ETH/USD', maker: 0.002, taker: 0.003 }
        })
      };

      const { feeRate, feeAmount } = await service.getTradingFees(
        exchangeStub,
        'kraken',
        OrderType.MARKET,
        1000,
        'BTC/USD'
      );

      expect(feeRate).toBe(0.0026);
      expect(feeAmount).toBeCloseTo(2.6);
    });

    it('defaults feeRate to 0.001 when API returns non-numeric rate', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockResolvedValue({ maker: 'bogus', taker: null })
      };

      const { feeRate, feeAmount } = await service.getTradingFees(exchangeStub, 'binance', OrderType.MARKET, 500);
      expect(feeRate).toBe(0.001);
      expect(feeAmount).toBe(0.5);
    });

    it('falls back to market data when API fails', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockRejectedValue(new Error('api down')),
        markets: { BTCUSDT: { maker: 0.002, taker: 0.003 } }
      };

      const { feeRate, feeAmount } = await service.getTradingFees(exchangeStub, 'binance', OrderType.LIMIT, 1000);

      expect(feeRate).toBe(0.002);
      expect(feeAmount).toBe(2);
    });

    it('falls back to defaults when no market data', async () => {
      const exchangeStub: any = {
        fetchTradingFees: jest.fn().mockRejectedValue(new Error('api down')),
        markets: {}
      };

      const { feeRate, feeAmount } = await service.getTradingFees(exchangeStub, 'unknown', OrderType.MARKET, 100);

      expect(feeRate).toBe(0.001);
      expect(feeAmount).toBeCloseTo(0.1);
    });
  });

  describe('getDefaultFees', () => {
    it('returns kraken-specific fees', () => {
      expect(service.getDefaultFees('kraken')).toEqual({ maker: 0.0016, taker: 0.0026 });
    });

    it('returns generic default for unknown exchange', () => {
      expect(service.getDefaultFees('mystery')).toEqual({ maker: 0.001, taker: 0.001 });
    });
  });

  describe('calculateSlippage', () => {
    it('calculates slippage from order book (buy/asks)', () => {
      const orderBook: any = {
        asks: [
          [100, 0.5],
          [110, 0.5]
        ],
        bids: [[99, 1]]
      };
      const slippage = service.calculateSlippage(orderBook, 0.75, OrderSide.BUY);
      // Weighted avg: (0.5*100 + 0.25*110) / 0.75 = 103.33 → 3.33%
      expect(slippage).toBeCloseTo(3.33, 2);
    });

    it('calculates slippage from order book (sell/bids)', () => {
      const orderBook: any = {
        asks: [[101, 1]],
        bids: [
          [100, 0.5],
          [90, 0.5]
        ]
      };
      const slippage = service.calculateSlippage(orderBook, 0.75, OrderSide.SELL);
      // Weighted avg: (0.5*100 + 0.25*90) / 0.75 = 96.67 → 3.33% vs 100
      expect(slippage).toBeCloseTo(3.33, 2);
    });

    it('returns 0 for empty book', () => {
      expect(service.calculateSlippage({ asks: [], bids: [] } as any, 1, OrderSide.BUY)).toBe(0);
    });

    it('returns 0 for zero market price', () => {
      const orderBook: any = { asks: [[0, 1]] };
      expect(service.calculateSlippage(orderBook, 1, OrderSide.BUY)).toBe(0);
    });
  });
});
