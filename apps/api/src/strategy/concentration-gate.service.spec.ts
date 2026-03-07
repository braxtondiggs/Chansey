import { ConcentrationGateService } from './concentration-gate.service';
import { ConcentrationCheckService } from './risk/concentration-check.service';

import { ExchangeBalanceDto } from '../balance/dto';

describe('ConcentrationGateService', () => {
  let service: ConcentrationGateService;
  let checkService: ConcentrationCheckService;

  beforeEach(() => {
    checkService = new ConcentrationCheckService();
    service = new ConcentrationGateService(checkService);
  });

  describe('buildAssetAllocations', () => {
    it('should flatten exchange balances and filter zero-value assets', () => {
      const exchanges: ExchangeBalanceDto[] = [
        {
          id: 'ex1',
          slug: 'binance',
          name: 'Binance',
          balances: [
            { asset: 'BTC', free: '1', locked: '0', usdValue: 50000 },
            { asset: 'ETH', free: '10', locked: '0', usdValue: 30000 },
            { asset: 'DOGE', free: '100', locked: '0', usdValue: 0 }
          ],
          totalUsdValue: 80000,
          timestamp: new Date()
        } as ExchangeBalanceDto
      ];

      const assets = service.buildAssetAllocations(exchanges);
      expect(assets).toEqual([
        { symbol: 'BTC', usdValue: 50000 },
        { symbol: 'ETH', usdValue: 30000 }
      ]);
    });

    it('should produce separate entries per exchange (not aggregated)', () => {
      const exchanges: ExchangeBalanceDto[] = [
        {
          id: 'ex1',
          slug: 'binance',
          name: 'Binance',
          balances: [{ asset: 'BTC', free: '0.5', locked: '0', usdValue: 25000 }],
          totalUsdValue: 25000,
          timestamp: new Date()
        } as ExchangeBalanceDto,
        {
          id: 'ex2',
          slug: 'coinbase',
          name: 'Coinbase',
          balances: [{ asset: 'BTC', free: '0.5', locked: '0', usdValue: 25000 }],
          totalUsdValue: 25000,
          timestamp: new Date()
        } as ExchangeBalanceDto
      ];

      const assets = service.buildAssetAllocations(exchanges);
      expect(assets).toEqual([
        { symbol: 'BTC', usdValue: 25000 },
        { symbol: 'BTC', usdValue: 25000 }
      ]);
    });

    it('should handle exchange with undefined balances', () => {
      const exchanges = [
        { id: 'ex1', slug: 'x', name: 'X', balances: undefined, totalUsdValue: 0, timestamp: new Date() }
      ] as unknown as ExchangeBalanceDto[];
      expect(service.buildAssetAllocations(exchanges)).toEqual([]);
    });

    it('should return empty array for no exchanges', () => {
      expect(service.buildAssetAllocations([])).toEqual([]);
    });
  });

  describe('checkTrade', () => {
    it('should allow trade when concentration is within limits', () => {
      const assets = [
        { symbol: 'BTC', usdValue: 2000 },
        { symbol: 'ETH', usdValue: 8000 }
      ];

      const result = service.checkTrade(assets, 'BTC/USDT', 500, 3, 'buy');
      expect(result.allowed).toBe(true);
      expect(result.adjustedQuantity).toBeUndefined();
    });

    it('should block when asset already at hard limit', () => {
      const assets = [
        { symbol: 'BTC', usdValue: 7000 },
        { symbol: 'ETH', usdValue: 3000 }
      ];

      const result = service.checkTrade(assets, 'BTC/USDT', 1000, 3, 'buy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('BTC');
    });

    it('should reduce trade quantity when it would exceed hard limit', () => {
      // BTC at 20% of 10k, risk 3 hard limit = 35%
      // Buying 2000 would push BTC to (2000+2000)/(10000+2000) = 33% — still under
      // Buying 3000 would push BTC to (2000+3000)/(10000+3000) = 38.5% — over
      const assets = [
        { symbol: 'BTC', usdValue: 2000 },
        { symbol: 'ETH', usdValue: 8000 }
      ];

      const result = service.checkTrade(assets, 'BTC/USDT', 3000, 3, 'buy');
      expect(result.allowed).toBe(true);
      expect(result.adjustedQuantity).toBeDefined();
      expect(result.adjustedQuantity).toBeGreaterThan(0);
      expect(result.adjustedQuantity).toBeLessThan(1);
    });

    it.each(['sell', 'short_exit', 'SELL'])('should always allow %s actions', (action) => {
      const assets = [
        { symbol: 'BTC', usdValue: 9000 },
        { symbol: 'ETH', usdValue: 1000 }
      ];

      const result = service.checkTrade(assets, 'BTC/USDT', 1000, 3, action);
      expect(result.allowed).toBe(true);
    });

    it('should always allow stablecoin trades', () => {
      const assets = [
        { symbol: 'BTC', usdValue: 9000 },
        { symbol: 'USDT', usdValue: 1000 }
      ];

      const result = service.checkTrade(assets, 'USDT/USD', 5000, 3, 'buy');
      expect(result.allowed).toBe(true);
    });

    it('should respect overrideLimit parameter', () => {
      const assets = [
        { symbol: 'BTC', usdValue: 4000 },
        { symbol: 'ETH', usdValue: 6000 }
      ];

      // Default risk 3 hard limit = 35%, BTC at 40% current → blocked
      // But override at 0.60 → allowed
      const result = service.checkTrade(assets, 'BTC/USDT', 500, 3, 'buy', 0.6);
      expect(result.allowed).toBe(true);

      // Override at 0.20 → blocked even though default would allow
      const result2 = service.checkTrade(assets, 'BTC/USDT', 500, 3, 'buy', 0.2);
      expect(result2.allowed).toBe(false);
    });

    it('should allow trade when portfolio is empty (totalValue = 0)', () => {
      const result = service.checkTrade([], 'BTC/USDT', 1000, 3, 'buy');
      expect(result.allowed).toBe(true);
    });
  });
});
