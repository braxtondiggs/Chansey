import { Logger } from '@nestjs/common';

import { PaperTradingMarketDataService } from './paper-trading-market-data.service';

import type { ExchangeManagerService } from '../../exchange/exchange-manager.service';

const createService = (overrides: Partial<{ cacheManager: any; exchangeManager: any; config: any }> = {}) => {
  const cacheManager = overrides.cacheManager ?? {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn()
  };

  const exchangeManager = overrides.exchangeManager ?? {
    formatSymbol: jest.fn(),
    getExchangeClient: jest.fn(),
    getPublicClient: jest.fn()
  };

  const config = overrides.config ?? { priceCacheTtlMs: 1000 };

  return {
    service: new PaperTradingMarketDataService(config as any, cacheManager, exchangeManager as ExchangeManagerService),
    cacheManager,
    exchangeManager
  };
};

describe('PaperTradingMarketDataService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns cached price data when available', async () => {
    const cached = {
      symbol: 'BTC/USD',
      price: 42000,
      timestamp: new Date(),
      source: 'binance'
    };

    const { service, cacheManager, exchangeManager } = createService({
      cacheManager: {
        get: jest.fn().mockResolvedValue(cached),
        set: jest.fn()
      }
    });

    const result = await service.getCurrentPrice('binance', 'BTC/USD');

    expect(result).toBe(cached);
    expect(exchangeManager.getPublicClient).not.toHaveBeenCalled();
    expect(cacheManager.set).not.toHaveBeenCalled();
  });

  it('fetches and caches price data when not cached', async () => {
    const client = {
      fetchTicker: jest.fn().mockResolvedValue({
        last: 45000,
        bid: 44950,
        ask: 45050,
        timestamp: 1700000000000
      })
    };

    const cacheManager = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn()
    };

    const exchangeManager = {
      formatSymbol: jest.fn().mockReturnValue('BTC/USDT'),
      getPublicClient: jest.fn().mockResolvedValue(client)
    };

    const { service } = createService({ cacheManager, exchangeManager });

    const result = await service.getCurrentPrice('binance', 'BTC/USDT');

    expect(exchangeManager.formatSymbol).toHaveBeenCalledWith('binance', 'BTC/USDT');
    expect(client.fetchTicker).toHaveBeenCalledWith('BTC/USDT');
    expect(cacheManager.set).toHaveBeenCalledWith(
      'paper-trading:price:binance:BTC/USDT',
      expect.objectContaining({
        symbol: 'BTC/USDT',
        price: 45000,
        bid: 44950,
        ask: 45050,
        source: 'binance'
      }),
      1000
    );
    expect(result.price).toBe(45000);
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
});
