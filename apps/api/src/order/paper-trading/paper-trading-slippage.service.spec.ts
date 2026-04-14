import { Logger } from '@nestjs/common';

import { PaperTradingSlippageService } from './paper-trading-slippage.service';

import type { ExchangeManagerService } from '../../exchange/exchange-manager.service';

const createService = (
  overrides: Partial<{
    cacheManager: any;
    exchangeManager: any;
    config: any;
  }> = {}
) => {
  const cacheManager = overrides.cacheManager ?? {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn()
  };

  const exchangeManager = overrides.exchangeManager ?? {
    formatSymbol: jest.fn().mockImplementation((_slug: string, symbol: string) => symbol),
    getExchangeClient: jest.fn(),
    getPublicClient: jest.fn()
  };

  const config = overrides.config ?? { priceCacheTtlMs: 1000 };

  return {
    service: new PaperTradingSlippageService(config as any, cacheManager, exchangeManager as ExchangeManagerService),
    cacheManager,
    exchangeManager
  };
};

describe('PaperTradingSlippageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calculates slippage from order book depth', async () => {
    const { service } = createService();

    jest.spyOn(service, 'getOrderBook').mockResolvedValue({
      symbol: 'BTC/USD',
      bids: [],
      asks: [
        { price: 100, quantity: 1 },
        { price: 110, quantity: 1 }
      ],
      timestamp: new Date()
    });

    const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 1.5, 'BUY');

    expect(result.estimatedPrice).toBeCloseTo(103.333, 3);
    expect(result.slippageBps).toBeCloseTo(337.333, 3);
    expect(result.marketImpact).toBe(4);
  });

  it('falls back to fixed slippage when order book lookup fails', async () => {
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { service } = createService();

    jest.spyOn(service, 'getOrderBook').mockRejectedValue(new Error('boom'));

    const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 1, 'BUY');

    expect(result).toEqual({ estimatedPrice: 0, slippageBps: 10, marketImpact: 0 });
    loggerSpy.mockRestore();
  });

  describe('getOrderBook', () => {
    it('returns cached order book when available', async () => {
      const cached = {
        symbol: 'BTC/USD',
        bids: [{ price: 100, quantity: 1 }],
        asks: [{ price: 101, quantity: 1 }],
        timestamp: new Date()
      };

      const { service, exchangeManager } = createService({
        cacheManager: {
          get: jest.fn().mockResolvedValue(cached),
          set: jest.fn()
        }
      });

      const result = await service.getOrderBook('binance', 'BTC/USD');

      expect(result).toBe(cached);
      expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    });

    it('fetches, maps, and caches order book on cache miss', async () => {
      const rawOrderBook = {
        bids: [
          [100, 5],
          [99, 10]
        ],
        asks: [
          [101, 3],
          [102, 7]
        ],
        timestamp: 1700000000000
      };

      const client = { fetchOrderBook: jest.fn().mockResolvedValue(rawOrderBook) };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getOrderBook('binance', 'BTC/USD', 10);

      expect(client.fetchOrderBook).toHaveBeenCalledWith('BTC/USD', 10);
      expect(result.bids).toEqual([
        { price: 100, quantity: 5 },
        { price: 99, quantity: 10 }
      ]);
      expect(result.asks).toEqual([
        { price: 101, quantity: 3 },
        { price: 102, quantity: 7 }
      ]);
      // Cache TTL capped at min(cacheTtlMs, 2000)
      expect(cacheManager.set).toHaveBeenCalledWith('paper-trading:orderbook:binance:BTC/USD', result, 1000);
    });

    it('uses authenticated client when user is provided', async () => {
      const rawOrderBook = {
        bids: [[100, 5]],
        asks: [[101, 3]],
        timestamp: 1700000000000
      };

      const client = { fetchOrderBook: jest.fn().mockResolvedValue(rawOrderBook) };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getExchangeClient: jest.fn().mockResolvedValue(client),
        getPublicClient: jest.fn()
      };

      const { service } = createService({ cacheManager, exchangeManager });
      const user = { id: 'user-1' } as any;

      await service.getOrderBook('binance', 'BTC/USD', 10, user);

      expect(exchangeManager.getExchangeClient).toHaveBeenCalledWith('binance', user);
      expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    });

    it('throws and logs on fetch failure', async () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();

      const client = { fetchOrderBook: jest.fn().mockRejectedValue(new Error('exchange down')) };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ cacheManager, exchangeManager });

      await expect(service.getOrderBook('binance', 'BTC/USD')).rejects.toThrow('exchange down');
      expect(loggerSpy).toHaveBeenCalled();
      loggerSpy.mockRestore();
    });
  });

  describe('calculateRealisticSlippage edge cases', () => {
    it('returns fixed slippage when order book has empty levels', async () => {
      const { service } = createService();

      jest.spyOn(service, 'getOrderBook').mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [],
        asks: [],
        timestamp: new Date()
      });

      const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 1, 'BUY');

      expect(result).toEqual({ estimatedPrice: 0, slippageBps: 10, marketImpact: 0 });
    });

    it('returns high slippage when quantity exceeds available liquidity', async () => {
      const { service } = createService();

      jest.spyOn(service, 'getOrderBook').mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [{ price: 100, quantity: 0 }],
        asks: [{ price: 101, quantity: 0 }],
        timestamp: new Date()
      });

      const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 10, 'BUY');

      expect(result.slippageBps).toBe(50);
      expect(result.estimatedPrice).toBe(101);
    });

    it('handles partial fill when quantity exceeds total liquidity', async () => {
      const { service } = createService();

      jest.spyOn(service, 'getOrderBook').mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [],
        asks: [
          { price: 100, quantity: 1 },
          { price: 105, quantity: 1 }
        ],
        timestamp: new Date()
      });

      // Request 5 but only 2 available — partial fill
      const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 5, 'BUY');

      // VWAP = (1*100 + 1*105) / 2 = 102.5
      expect(result.estimatedPrice).toBeCloseTo(102.5, 1);
      expect(result.marketImpact).toBe(4); // 2 levels * 2
    });

    it('filters out zero-price and zero-quantity levels from order book', async () => {
      const rawOrderBook = {
        bids: [
          [0, 5],
          [99, 10]
        ],
        asks: [
          [101, 0],
          [102, 7],
          [0, 3]
        ],
        timestamp: 1700000000000
      };

      const client = { fetchOrderBook: jest.fn().mockResolvedValue(rawOrderBook) };

      const cacheManager = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn()
      };

      const exchangeManager = {
        formatSymbol: jest.fn().mockReturnValue('BTC/USD'),
        getPublicClient: jest.fn().mockResolvedValue(client)
      };

      const { service } = createService({ cacheManager, exchangeManager });
      const result = await service.getOrderBook('binance', 'BTC/USD', 10);

      // Zero-price bid and zero-quantity/zero-price asks should be filtered out
      expect(result.bids).toEqual([{ price: 99, quantity: 10 }]);
      expect(result.asks).toEqual([{ price: 102, quantity: 7 }]);
    });

    it('uses bids for SELL side slippage', async () => {
      const { service } = createService();

      jest.spyOn(service, 'getOrderBook').mockResolvedValue({
        symbol: 'BTC/USD',
        bids: [
          { price: 100, quantity: 2 },
          { price: 90, quantity: 2 }
        ],
        asks: [],
        timestamp: new Date()
      });

      const result = await service.calculateRealisticSlippage('binance', 'BTC/USD', 3, 'SELL');

      // VWAP = (2*100 + 1*90) / 3 = 96.667
      expect(result.estimatedPrice).toBeCloseTo(96.667, 2);
      // Slippage from best bid (100): |96.667 - 100| / 100 * 10000 = 333.33 bps + 4 impact
      expect(result.slippageBps).toBeCloseTo(337.333, 0);
    });
  });
});
