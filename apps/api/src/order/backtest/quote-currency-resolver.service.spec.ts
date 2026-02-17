import { DEFAULT_QUOTE_CURRENCY_FALLBACK, QuoteCurrencyResolverService } from './quote-currency-resolver.service';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { QuoteCurrencyNotFoundException } from '../../common/exceptions/backtest';

describe('QuoteCurrencyResolverService', () => {
  const createCoin = (symbol: string, id?: string): Coin =>
    ({
      id: id ?? symbol.toLowerCase(),
      symbol,
      name: symbol,
      slug: symbol.toLowerCase()
    }) as Coin;

  const createVirtualCoin = (symbol: string): Coin =>
    ({
      id: `${symbol}-virtual`,
      symbol,
      name: symbol,
      slug: symbol.toLowerCase()
    }) as Coin;

  const createService = (coinService: { getCoinBySymbol: jest.Mock }) =>
    new QuoteCurrencyResolverService(coinService as unknown as CoinService);

  describe('resolveQuoteCurrency', () => {
    it('returns preferred currency when available', async () => {
      const usdt = createCoin('USDT');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => (symbol.toUpperCase() === 'USDT' ? usdt : null))
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('USDT');

      expect(result).toBe(usdt);
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('USDT', undefined, false);
    });

    it('uses fallback when preferred currency not found', async () => {
      const usdc = createCoin('USDC');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => (symbol.toUpperCase() === 'USDC' ? usdc : null))
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('USDT');

      expect(result).toBe(usdc);
      // Should have tried USDT first, then fallback to USDC
      expect(coinService.getCoinBySymbol).toHaveBeenCalledTimes(2);
      expect(coinService.getCoinBySymbol).toHaveBeenNthCalledWith(1, 'USDT', undefined, false);
      expect(coinService.getCoinBySymbol).toHaveBeenNthCalledWith(2, 'USDC', undefined, false);
    });

    it('rejects virtual coins (id contains "virtual")', async () => {
      const virtualUsdt = createVirtualCoin('USDT');
      const realUsdc = createCoin('USDC');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => {
          if (symbol.toUpperCase() === 'USDT') return virtualUsdt;
          if (symbol.toUpperCase() === 'USDC') return realUsdc;
          return null;
        })
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('USDT');

      // Should skip virtual USDT and return real USDC
      expect(result).toBe(realUsdc);
      expect(result.id).not.toContain('virtual');
    });

    it('rejects coins with id starting with "USD-"', async () => {
      const usdCoin = createCoin('USD', 'USD-virtual');
      const realUsdt = createCoin('USDT');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => {
          if (symbol.toUpperCase() === 'USD') return usdCoin;
          if (symbol.toUpperCase() === 'USDT') return realUsdt;
          return null;
        })
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('USD');

      // Should skip USD-virtual and return real USDT from fallback
      expect(result).toBe(realUsdt);
    });

    it('throws QuoteCurrencyNotFoundException when no quote currency can be resolved', async () => {
      const coinService = {
        getCoinBySymbol: jest.fn(async () => null)
      };
      const service = createService(coinService);

      await expect(service.resolveQuoteCurrency('USDT')).rejects.toThrow(QuoteCurrencyNotFoundException);
      await expect(service.resolveQuoteCurrency('USDT')).rejects.toThrow(
        /No valid quote currency found.*USDT.*USDC.*BUSD.*DAI/
      );
    });

    it('uses default USDT when no preferred currency specified', async () => {
      const usdt = createCoin('USDT');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => (symbol.toUpperCase() === 'USDT' ? usdt : null))
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency();

      expect(result).toBe(usdt);
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('USDT', undefined, false);
    });

    it('handles case-insensitive preferred currency', async () => {
      const usdt = createCoin('USDT');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => (symbol.toUpperCase() === 'USDT' ? usdt : null))
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('usdt');

      expect(result).toBe(usdt);
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('USDT', undefined, false);
    });

    it('does not duplicate preferred currency in fallback chain', async () => {
      const usdc = createCoin('USDC');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => {
          if (symbol.toUpperCase() === 'USDT') return null;
          if (symbol.toUpperCase() === 'USDC') return usdc;
          return null;
        })
      };
      const service = createService(coinService);

      // Resolve with USDT while custom fallback repeats the preferred currency
      const result = await service.resolveQuoteCurrency('USDT', ['usdt', 'USDC']);

      expect(result).toBe(usdc);
      // Should only call once for USDT, not twice
      const calls = coinService.getCoinBySymbol.mock.calls.filter((call) => call[0].toUpperCase() === 'USDT');
      expect(calls).toHaveLength(1);
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('USDC', undefined, false);
    });

    it('accepts custom fallback chain', async () => {
      const dai = createCoin('DAI');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => (symbol.toUpperCase() === 'DAI' ? dai : null))
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('USDT', ['DAI']);

      expect(result).toBe(dai);
      // Should have tried USDT first, then DAI
      expect(coinService.getCoinBySymbol).toHaveBeenCalledTimes(2);
    });

    it('tries all fallback currencies in order before failing', async () => {
      const busd = createCoin('BUSD');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => (symbol.toUpperCase() === 'BUSD' ? busd : null))
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('INVALID');

      expect(result).toBe(busd);
      // Should have tried INVALID, then USDT, USDC, then BUSD
      expect(coinService.getCoinBySymbol).toHaveBeenCalledTimes(4);
    });

    it('skips virtual coins in the fallback chain', async () => {
      const virtualUsdc = createVirtualCoin('USDC');
      const dai = createCoin('DAI');
      const coinService = {
        getCoinBySymbol: jest.fn(async (symbol: string) => {
          if (symbol.toUpperCase() === 'USDT') return null;
          if (symbol.toUpperCase() === 'USDC') return virtualUsdc;
          if (symbol.toUpperCase() === 'DAI') return dai;
          return null;
        })
      };
      const service = createService(coinService);

      const result = await service.resolveQuoteCurrency('USDT', ['USDC', 'DAI']);

      expect(result).toBe(dai);
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('USDC', undefined, false);
      expect(coinService.getCoinBySymbol).toHaveBeenCalledWith('DAI', undefined, false);
    });
  });

  describe('DEFAULT_QUOTE_CURRENCY_FALLBACK', () => {
    it('contains common stablecoins', () => {
      expect(DEFAULT_QUOTE_CURRENCY_FALLBACK).toContain('USDT');
      expect(DEFAULT_QUOTE_CURRENCY_FALLBACK).toContain('USDC');
      expect(DEFAULT_QUOTE_CURRENCY_FALLBACK).toContain('BUSD');
      expect(DEFAULT_QUOTE_CURRENCY_FALLBACK).toContain('DAI');
    });

    it('has USDT as first fallback', () => {
      expect(DEFAULT_QUOTE_CURRENCY_FALLBACK[0]).toBe('USDT');
    });
  });
});
