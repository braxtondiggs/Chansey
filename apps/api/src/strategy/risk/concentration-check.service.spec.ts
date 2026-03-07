import { AssetAllocation, ConcentrationCheckService } from './concentration-check.service';

describe('ConcentrationCheckService', () => {
  let service: ConcentrationCheckService;

  beforeEach(() => {
    service = new ConcentrationCheckService();
  });

  describe('checkConcentration', () => {
    it('should pass for a balanced portfolio', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 2000 },
        { symbol: 'ETH', usdValue: 2000 },
        { symbol: 'SOL', usdValue: 2000 },
        { symbol: 'ADA', usdValue: 2000 },
        { symbol: 'XRP', usdValue: 2000 }
      ];

      const result = service.checkConcentration(assets, 3);
      expect(result.breached).toBe(false);
      expect(result.breaches).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.totalValue).toBe(10000);
    });

    it('should detect breach for concentrated portfolio', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 8000 },
        { symbol: 'ETH', usdValue: 2000 }
      ];

      const result = service.checkConcentration(assets, 3);
      expect(result.breached).toBe(true);
      expect(result.breaches).toHaveLength(1);
      expect(result.breaches[0]).toEqual({ symbol: 'BTC', concentration: 0.8, limit: 0.35 });
    });

    it('should report soft limit warnings without breaching', () => {
      // Risk level 3: hard=0.35, soft=0.30
      // All three are between 30-35% → all warn, none breach
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 3200 },
        { symbol: 'ETH', usdValue: 3400 },
        { symbol: 'SOL', usdValue: 3400 }
      ];

      const result = service.checkConcentration(assets, 3);
      expect(result.breached).toBe(false);
      expect(result.warnings.length).toBe(3);
      expect(result.warnings.every((w) => w.softLimit === 0.3)).toBe(true);
      expect(result.warnings.find((w) => w.symbol === 'BTC')!.concentration).toBe(0.32);
    });

    it('should exclude stablecoins from concentration checks', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'USDT', usdValue: 9000 },
        { symbol: 'BTC', usdValue: 1000 }
      ];

      // BTC is only 10% of $10000, USDT at 90% is skipped → no breach
      const result = service.checkConcentration(assets, 1);
      expect(result.breached).toBe(false);
      expect(result.breaches).toHaveLength(0);
    });

    it('should handle empty portfolio', () => {
      const result = service.checkConcentration([], 3);
      expect(result).toEqual({ breached: false, breaches: [], warnings: [], totalValue: 0 });
    });

    it('should aggregate by base symbol across trading pairs', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC/USDT', usdValue: 2000 },
        { symbol: 'BTC/USDC', usdValue: 2000 },
        { symbol: 'ETH/USDT', usdValue: 6000 }
      ];

      // BTC total: 4000/10000=40%, ETH: 6000/10000=60% — both above hard=0.35
      const result = service.checkConcentration(assets, 3);
      expect(result.breached).toBe(true);
      expect(result.breaches).toHaveLength(2);
      expect(result.breaches.map((b) => b.symbol).sort()).toEqual(['BTC', 'ETH']);
    });

    it('should use override limit when provided', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 4000 },
        { symbol: 'ETH', usdValue: 3500 },
        { symbol: 'SOL', usdValue: 2500 }
      ];

      // Without override: risk 3, hard=0.35 → BTC at 40% → breach
      expect(service.checkConcentration(assets, 3).breached).toBe(true);

      // With override: hard=0.45 → BTC at 40% → no breach
      expect(service.checkConcentration(assets, 3, 0.45).breached).toBe(false);
    });
  });

  describe('checkTradeAllowed', () => {
    const balancedPortfolio: AssetAllocation[] = [
      { symbol: 'BTC', usdValue: 2000 },
      { symbol: 'ETH', usdValue: 3000 },
      { symbol: 'SOL', usdValue: 5000 }
    ];

    it.each(['sell', 'short_exit', 'SELL', 'SHORT_EXIT', 'Sell'])('should always allow %s actions', (action) => {
      const result = service.checkTradeAllowed(balancedPortfolio, 'BTC/USDT', 50000, 3, action);
      expect(result.allowed).toBe(true);
    });

    it('should always allow stablecoin trades', () => {
      const result = service.checkTradeAllowed(balancedPortfolio, 'USDT/USD', 50000, 3, 'buy');
      expect(result.allowed).toBe(true);
    });

    it('should block when already at hard limit', () => {
      const concentrated: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 7000 },
        { symbol: 'ETH', usdValue: 3000 }
      ];

      const result = service.checkTradeAllowed(concentrated, 'BTC/USDT', 1000, 3, 'buy');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('already at hard limit');
      expect(result.reason).toContain('BTC');
    });

    it('should return adjusted quantity when trade would exceed hard limit', () => {
      // Risk level 3: hard=0.35
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 3000 },
        { symbol: 'ETH', usdValue: 7000 }
      ];

      // BTC at 30%, adding $1000 → 4000/11000=36.4% > 35%
      const result = service.checkTradeAllowed(assets, 'BTC/USDT', 1000, 3, 'buy');
      expect(result.allowed).toBe(true);
      expect(result.adjustedQuantity).toBeLessThan(1);
      expect(result.adjustedQuantity).toBeGreaterThan(0);
      expect(result.reason).toContain('reduced to');
    });

    it('should block when maxAdditionalUsd is zero despite being below hard limit', () => {
      // Edge case: currentConcentration < hard but numerically no room
      // Risk level 1: hard=0.25; BTC at 24.9%, but the math yields ~0
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 2499 },
        { symbol: 'ETH', usdValue: 7501 }
      ];

      // BTC at 24.99% < 25% hard, but adding $1000 → 3499/11000=31.8% > 25%
      // maxAdditional = (0.25*10000 - 2499) / 0.75 = 1/0.75 ≈ 1.33
      // adjustedQuantity = 1.33/1000 ≈ 0.00133 — very small but allowed
      const result = service.checkTradeAllowed(assets, 'BTC/USDT', 1000, 1, 'buy');
      expect(result.allowed).toBe(true);
      expect(result.adjustedQuantity).toBeLessThan(0.01);
    });

    it('should warn when post-trade exceeds soft limit but not hard', () => {
      // Risk level 3: hard=0.35, soft=0.30
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 2500 },
        { symbol: 'ETH', usdValue: 7500 }
      ];

      // BTC at 25%, adding $1000 → 3500/11000=31.8% > soft(30%) but < hard(35%)
      const result = service.checkTradeAllowed(assets, 'BTC/USDT', 1000, 3, 'buy');
      expect(result.allowed).toBe(true);
      expect(result.adjustedQuantity).toBeUndefined();
      expect(result.reason).toContain('soft limit');
    });

    it('should allow trade well within limits with no warning', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 1000 },
        { symbol: 'ETH', usdValue: 4000 },
        { symbol: 'SOL', usdValue: 5000 }
      ];

      // BTC at 10%, adding $500 → 1500/10500=14.3% < soft(30%)
      const result = service.checkTradeAllowed(assets, 'BTC/USDT', 500, 3, 'buy');
      expect(result.allowed).toBe(true);
      expect(result.adjustedQuantity).toBeUndefined();
      expect(result.reason).toBeUndefined();
    });

    it('should allow any trade on empty portfolio', () => {
      const result = service.checkTradeAllowed([], 'BTC/USDT', 1000, 3, 'buy');
      expect(result.allowed).toBe(true);
    });
  });

  describe('calculateMaxAdditionalUsd', () => {
    it('should calculate correct max additional USD', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 3000 },
        { symbol: 'ETH', usdValue: 7000 }
      ];

      // Risk level 3: hard=0.35
      // X = (0.35 * 10000 - 3000) / (1 - 0.35) = 500 / 0.65 ≈ 769.23
      const max = service.calculateMaxAdditionalUsd(assets, 'BTC', 3);
      expect(max).toBeCloseTo(769.23, 0);
    });

    it('should return 0 for already concentrated asset', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC', usdValue: 8000 },
        { symbol: 'ETH', usdValue: 2000 }
      ];

      const max = service.calculateMaxAdditionalUsd(assets, 'BTC', 3);
      expect(max).toBe(0);
    });

    it('should return 0 for empty portfolio', () => {
      expect(service.calculateMaxAdditionalUsd([], 'BTC', 3)).toBe(0);
    });

    it('should resolve trading pair symbols', () => {
      const assets: AssetAllocation[] = [
        { symbol: 'BTC/USDT', usdValue: 3000 },
        { symbol: 'ETH/USDT', usdValue: 7000 }
      ];

      const max = service.calculateMaxAdditionalUsd(assets, 'BTC/USDC', 3);
      expect(max).toBeCloseTo(769.23, 0);
    });
  });

  describe('resolveLimits', () => {
    it.each([
      [1, { hard: 0.25, soft: 0.2 }],
      [2, { hard: 0.3, soft: 0.25 }],
      [3, { hard: 0.35, soft: 0.3 }],
      [4, { hard: 0.45, soft: 0.4 }],
      [5, { hard: 0.55, soft: 0.5 }]
    ])('should return correct limits for risk level %i', (level, expected) => {
      expect(service.resolveLimits(level as number)).toEqual(expected);
    });

    it('should use override when provided', () => {
      const limits = service.resolveLimits(3, 0.4);
      expect(limits.hard).toBe(0.4);
      expect(limits.soft).toBeCloseTo(0.35);
    });

    it('should clamp override to [0.1, 0.8] range', () => {
      // Too low → clamped to 0.1
      const low = service.resolveLimits(3, 0.05);
      expect(low.hard).toBe(0.1);
      expect(low.soft).toBeCloseTo(0.05);

      // Too high → clamped to 0.8
      const high = service.resolveLimits(3, 0.99);
      expect(high.hard).toBe(0.8);
      expect(high.soft).toBeCloseTo(0.75);
    });

    it('should ignore override when zero or null', () => {
      expect(service.resolveLimits(3, 0)).toEqual({ hard: 0.35, soft: 0.3 });
      expect(service.resolveLimits(3, null)).toEqual({ hard: 0.35, soft: 0.3 });
    });

    it('should fallback to risk level 3 for unknown levels', () => {
      expect(service.resolveLimits(99)).toEqual({ hard: 0.35, soft: 0.3 });
    });
  });

  describe('extractBaseSymbol', () => {
    it.each([
      ['BTC/USDT', 'BTC'],
      ['ETH/USD', 'ETH'],
      ['BTC', 'BTC'],
      ['btc/usdt', 'BTC']
    ])('should extract "%s" → "%s"', (input, expected) => {
      expect(service.extractBaseSymbol(input)).toBe(expected);
    });
  });

  describe('isStablecoin', () => {
    it.each(['USDT', 'USDC', 'DAI', 'BUSD', 'USD', 'TUSD', 'USDP', 'usdt'])(
      'should identify %s as stablecoin',
      (symbol) => {
        expect(service.isStablecoin(symbol)).toBe(true);
      }
    );

    it.each(['BTC', 'ETH', 'SOL'])('should not flag %s as stablecoin', (symbol) => {
      expect(service.isStablecoin(symbol)).toBe(false);
    });
  });
});
