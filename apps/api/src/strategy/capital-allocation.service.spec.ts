import { CompositeRegimeType } from '@chansey/api-interfaces';

import { CapitalAllocationService, RegimeContext } from './capital-allocation.service';
import { StrategyConfig } from './entities/strategy-config.entity';

import { Order, OrderStatus } from '../order/order.entity';

// Helper to create a mock strategy
const createStrategy = (id: string): StrategyConfig => ({ id }) as StrategyConfig;

// Helper to create a mock filled order with gainLoss and strategyConfigId
const createOrder = (gainLoss: number | null | undefined, cost = 100, strategyConfigId?: string): Partial<Order> => ({
  gainLoss: gainLoss as number | undefined,
  cost,
  status: OrderStatus.FILLED,
  isAlgorithmicTrade: true,
  strategyConfigId
});

// Helper to create a score record
const createScore = (strategyConfigId: string, overallScore: number) => ({
  strategyConfigId,
  overallScore,
  calculatedAt: new Date()
});

// Reusable order sets — accepts strategyConfigId for batched query support
const makeKellyOrders = (
  wins: number,
  winAmount: number,
  losses: number,
  lossAmount: number,
  strategyConfigId?: string
) => [
  ...Array.from({ length: wins }, () => createOrder(winAmount, 100, strategyConfigId)),
  ...Array.from({ length: losses }, () => createOrder(lossAmount, 100, strategyConfigId))
];

describe('CapitalAllocationService', () => {
  let service: CapitalAllocationService;
  let mockOrderRepo: { find: jest.Mock };
  let mockScoreRepo: { find: jest.Mock };
  let mockAuditService: { createAuditLog: jest.Mock };

  beforeEach(() => {
    mockOrderRepo = { find: jest.fn().mockResolvedValue([]) };
    mockScoreRepo = { find: jest.fn().mockResolvedValue([]) };
    mockAuditService = { createAuditLog: jest.fn().mockResolvedValue({}) };
    service = new CapitalAllocationService(mockScoreRepo as any, mockOrderRepo as any, mockAuditService as any);
  });

  describe('allocateCapitalByKelly', () => {
    it.each([
      ['no strategies', 10000, []],
      ['zero capital', 0, [createStrategy('s1')]],
      ['negative capital', -100, [createStrategy('s1')]]
    ])('returns empty map when %s', async (_label, capital, strategies) => {
      const result = await service.allocateCapitalByKelly(capital as number, strategies as StrategyConfig[]);
      expect(result.size).toBe(0);
    });

    it('calculates correct Kelly fraction for 60% win rate, 2:1 win/loss ratio', async () => {
      // 60% wins, 40% losses; avg win = 200, avg loss = 100 → b = 2
      // Kelly: f = (2 * 0.6 - 0.4) / 2 = 0.4
      // Quarter-Kelly: 0.4 * 0.25 = 0.1
      mockOrderRepo.find.mockResolvedValue(makeKellyOrders(18, 200, 12, -100, 's1'));

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')]);

      expect(result.size).toBe(1);
      expect(result.get('s1')).toBeCloseTo(10000, 0);
    });

    it('allocates proportionally when multiple strategies have different Kelly fractions', async () => {
      // Strategy 1: 60% win rate, b=2 → quarter-Kelly 0.1
      // Strategy 2: 70% win rate, b=3 → quarter-Kelly 0.15
      mockOrderRepo.find.mockResolvedValue([
        ...makeKellyOrders(18, 200, 12, -100, 's1'),
        ...makeKellyOrders(21, 300, 9, -100, 's2')
      ]);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1'), createStrategy('s2')]);

      expect(result.size).toBe(2);
      const s1Amount = result.get('s1')!;
      const s2Amount = result.get('s2')!;

      expect(s2Amount).toBeGreaterThanOrEqual(s1Amount);
      // Dynamic cap = max(15%, 1/2) = 50% = $5000; capped capital redistributed
      expect(s2Amount).toBeLessThanOrEqual(5000);
      // With redistribution, total should use all capital
      expect(s1Amount + s2Amount).toBeCloseTo(10000, 0);
    });

    it('falls back to score-based allocation when trades < 30', async () => {
      mockOrderRepo.find.mockResolvedValue(Array.from({ length: 10 }, () => createOrder(100, 100, 's1')));
      mockScoreRepo.find.mockResolvedValue([createScore('s1', 80)]);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')]);

      expect(result.size).toBe(1);
      expect(result.get('s1')).toBeCloseTo(10000, 0);
      expect(mockScoreRepo.find).toHaveBeenCalled();
    });

    it('clamps negative Kelly fractions to 0 (losing strategy)', async () => {
      // 20% win rate, b=0.5 → f = (0.5*0.2 - 0.8)/0.5 = -1.4 → clamped to 0
      mockOrderRepo.find.mockResolvedValue(makeKellyOrders(6, 50, 24, -100, 's1'));

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')]);

      expect(result.size).toBe(0);
    });

    it('caps allocation at 15% when there are 8+ strategies', async () => {
      // With 8 strategies, dynamic cap = max(15%, 1/8=12.5%) = 15%
      const strategies = Array.from({ length: 8 }, (_, i) => createStrategy(`s${i}`));

      // s0 has a much stronger edge; rest are moderate
      mockOrderRepo.find.mockResolvedValue([
        ...makeKellyOrders(27, 500, 3, -100, 's0'),
        ...strategies.slice(1).flatMap((s) => makeKellyOrders(16, 110, 14, -100, s.id))
      ]);

      const result = await service.allocateCapitalByKelly(10000, strategies);

      for (const [, amount] of result.entries()) {
        expect(amount).toBeLessThanOrEqual(10000 * 0.15 + 0.01);
      }
    });

    it('uses dynamic cap with fewer strategies (1/N > 15%)', async () => {
      // 3 strategies: dynamic cap = max(15%, 1/3=33%) = 33%
      mockOrderRepo.find.mockResolvedValue([
        ...makeKellyOrders(27, 500, 3, -100, 's1'),
        ...makeKellyOrders(16, 110, 14, -100, 's2'),
        ...makeKellyOrders(16, 110, 14, -100, 's3')
      ]);

      const result = await service.allocateCapitalByKelly(10000, [
        createStrategy('s1'),
        createStrategy('s2'),
        createStrategy('s3')
      ]);

      const s1Amount = result.get('s1')!;
      expect(s1Amount).toBeGreaterThan(1500);
      expect(s1Amount).toBeLessThanOrEqual(3334);

      const total = Array.from(result.values()).reduce((sum, v) => sum + v, 0);
      expect(total).toBeLessThanOrEqual(10000);
      expect(total).toBeGreaterThan(0);
    });

    it('excludes strategies below MIN_ALLOCATION_PER_STRATEGY ($50)', async () => {
      const strategies = Array.from({ length: 10 }, (_, i) => createStrategy(`s${i}`));
      mockOrderRepo.find.mockResolvedValue(strategies.flatMap((s) => makeKellyOrders(18, 200, 12, -100, s.id)));

      const result = await service.allocateCapitalByKelly(100, strategies);

      expect(result.size).toBe(0);
    });

    it('handles mixed Kelly and score-based fallback strategies', async () => {
      mockOrderRepo.find.mockResolvedValue([
        ...makeKellyOrders(18, 200, 12, -100, 's1'),
        ...Array.from({ length: 5 }, () => createOrder(100, 100, 's2'))
      ]);

      mockScoreRepo.find.mockResolvedValue([createScore('s2', 75)]);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1'), createStrategy('s2')]);

      expect(result.size).toBe(2);
      expect(result.get('s1')!).toBeGreaterThan(0);
      expect(result.get('s2')!).toBeGreaterThan(0);
      expect(result.get('s1')! + result.get('s2')!).toBeCloseTo(10000, 0);
    });

    it('excludes fallback strategies with score below MIN_SCORE_THRESHOLD', async () => {
      mockOrderRepo.find.mockResolvedValue(Array.from({ length: 5 }, () => createOrder(100, 100, 's1')));
      mockScoreRepo.find.mockResolvedValue([createScore('s1', 30)]);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')]);

      expect(result.size).toBe(0);
    });

    it('handles strategy with all winning trades (no losses)', async () => {
      mockOrderRepo.find.mockResolvedValue(Array.from({ length: 30 }, () => createOrder(150, 100, 's1')));

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')]);

      expect(result.size).toBe(1);
      expect(result.get('s1')).toBeCloseTo(10000, 0);
    });

    it('returns empty map when all strategies fall back with no scores', async () => {
      mockOrderRepo.find.mockResolvedValue(Array.from({ length: 5 }, () => createOrder(100, 100, 's1')));
      mockScoreRepo.find.mockResolvedValue([]);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1'), createStrategy('s2')]);

      expect(result.size).toBe(0);
    });

    // ---- New test cases ----

    it('excludes breakeven trades (gainLoss === 0) from win/loss statistics', async () => {
      // 20 wins + 12 losses = 32 resolved, + 5 breakeven = 37 total
      // Breakeven trades are excluded from Kelly calc
      // p = 20/32 = 0.625, b = 200/100 = 2
      // f = (2*0.625 - 0.375)/2 = 0.4375, quarter = 0.109
      const orders = [
        ...Array.from({ length: 20 }, () => createOrder(200, 100, 's1')),
        ...Array.from({ length: 12 }, () => createOrder(-100, 100, 's1')),
        ...Array.from({ length: 5 }, () => createOrder(0, 100, 's1'))
      ];
      mockOrderRepo.find.mockResolvedValue(orders);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')]);

      expect(result.size).toBe(1);
      // Single strategy gets all capital
      expect(result.get('s1')).toBeCloseTo(10000, 0);
    });

    it('redistributes capped capital to remaining strategies', async () => {
      // 4 strategies: s0 has a very strong edge (should be capped),
      // the rest have moderate edges and should receive redistributed capital
      const strategies = Array.from({ length: 4 }, (_, i) => createStrategy(`s${i}`));

      mockOrderRepo.find.mockResolvedValue([
        ...makeKellyOrders(28, 1000, 2, -100, 's0'), // Very strong → would get >25% without cap
        ...makeKellyOrders(16, 120, 14, -100, 's1'),
        ...makeKellyOrders(16, 120, 14, -100, 's2'),
        ...makeKellyOrders(16, 120, 14, -100, 's3')
      ]);

      const result = await service.allocateCapitalByKelly(10000, strategies);

      const total = Array.from(result.values()).reduce((sum, v) => sum + v, 0);
      // With iterative redistribution, total should be close to full capital utilization
      expect(total).toBeCloseTo(10000, 0);
      expect(result.size).toBe(4);

      // s0 should be capped at max(15%, 1/4=25%) = 25%
      expect(result.get('s0')!).toBeLessThanOrEqual(2500 + 0.01);
    });

    it('uses only resolved trades for Kelly when null/undefined gainLoss orders are present', async () => {
      // 20 wins + 12 losses = 32 resolved (>= 30), + 5 null + 5 undefined = 42 total orders
      // Non-resolved orders should NOT inflate the denominator
      // Correct: p = 20/32 = 0.625 (not 20/42 = 0.476)
      const orders = [
        ...Array.from({ length: 20 }, () => createOrder(200, 100, 's1')),
        ...Array.from({ length: 12 }, () => createOrder(-100, 100, 's1')),
        ...Array.from({ length: 5 }, () => createOrder(null, 100, 's1')),
        ...Array.from({ length: 5 }, () => createOrder(undefined, 100, 's1'))
      ];
      mockOrderRepo.find.mockResolvedValue(orders);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')]);

      expect(result.size).toBe(1);
      // With correct denominator (32 resolved), this is a profitable strategy
      // p = 20/32 = 0.625, b = 2, f = (2*0.625 - 0.375)/2 ≈ 0.438, quarter ≈ 0.109
      expect(result.get('s1')).toBeCloseTo(10000, 0);
    });

    it('uses Kelly-equivalent normalization for score-based fallback fractions', async () => {
      // Under the new formula: score 50 → kellyEquiv = (2*50/100 - 1)*0.25 = 0 → excluded
      // Under the old formula: score 50 with totalScore > 0 would give a positive fraction
      // Score 75 → kellyEquiv = (2*75/100 - 1)*0.25 = 0.125 → gets allocation
      mockOrderRepo.find.mockResolvedValue([]); // No orders → both fall back to score

      mockScoreRepo.find.mockResolvedValue([createScore('s1', 50), createScore('s2', 75)]);

      const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1'), createStrategy('s2')]);

      // Score 50 produces kellyEquiv = 0, effectively excluded
      expect(result.has('s1')).toBe(false);
      expect(result.size).toBe(1);
      expect(result.get('s2')).toBeCloseTo(10000, 0);
    });
  });

  describe('regime-scaled allocation', () => {
    const setupKellyOrders = () => {
      mockOrderRepo.find.mockResolvedValue(makeKellyOrders(18, 200, 12, -100, 's1'));
    };

    it.each([
      [CompositeRegimeType.BULL, 3, 10000, 1],
      [CompositeRegimeType.NEUTRAL, 3, 5000, 1],
      [CompositeRegimeType.BEAR, 3, 1000, 1],
      [CompositeRegimeType.EXTREME, 3, 0, 0]
    ])(
      '%s regime at risk %i → $%i allocated (%i strategies)',
      async (regime, riskLevel, expectedCapital, expectedSize) => {
        setupKellyOrders();
        const ctx: RegimeContext = { compositeRegime: regime, riskLevel };
        const result = await service.allocateCapitalByKelly(10000, [createStrategy('s1')], ctx);

        expect(result.size).toBe(expectedSize);
        if (expectedSize > 0) {
          expect(result.get('s1')).toBeCloseTo(expectedCapital, 0);
        }
      }
    );

    it.each([
      [CompositeRegimeType.BEAR, 1, 500, 3, 1000],
      [CompositeRegimeType.NEUTRAL, 5, 7000, 3, 5000]
    ])(
      'risk differentiation in %s: risk %i ($%i) vs risk %i ($%i)',
      async (regime, lowRisk, lowExpected, highRisk, highExpected) => {
        setupKellyOrders();
        const resultLow = await service.allocateCapitalByKelly(10000, [createStrategy('s1')], {
          compositeRegime: regime,
          riskLevel: lowRisk
        });

        setupKellyOrders();
        const resultHigh = await service.allocateCapitalByKelly(10000, [createStrategy('s1')], {
          compositeRegime: regime,
          riskLevel: highRisk
        });

        expect(resultLow.get('s1')).toBeCloseTo(lowExpected, 0);
        expect(resultHigh.get('s1')).toBeCloseTo(highExpected, 0);
      }
    );

    it('writes audit log when regimeContext is provided', async () => {
      setupKellyOrders();
      const ctx: RegimeContext = { compositeRegime: CompositeRegimeType.NEUTRAL, riskLevel: 3 };
      await service.allocateCapitalByKelly(10000, [createStrategy('s1')], ctx);

      await new Promise((r) => setImmediate(r));

      expect(mockAuditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'REGIME_SCALED_ALLOCATION',
          entityType: 'capital-allocation',
          afterState: expect.objectContaining({
            compositeRegime: CompositeRegimeType.NEUTRAL,
            riskLevel: 3,
            regimeMultiplier: 0.5,
            effectiveCapital: 5000
          })
        })
      );
    });

    it('writes audit log with effectiveCapital 0 in EXTREME regime', async () => {
      setupKellyOrders();
      const ctx: RegimeContext = { compositeRegime: CompositeRegimeType.EXTREME, riskLevel: 3 };
      await service.allocateCapitalByKelly(10000, [createStrategy('s1')], ctx);

      await new Promise((r) => setImmediate(r));

      expect(mockAuditService.createAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'REGIME_SCALED_ALLOCATION',
          entityType: 'capital-allocation',
          afterState: expect.objectContaining({
            compositeRegime: CompositeRegimeType.EXTREME,
            regimeMultiplier: 0,
            effectiveCapital: 0,
            strategiesAllocated: 0,
            totalAllocated: 0
          })
        })
      );
    });

    it('excludes strategies when scaled capital falls below $50 minimum', async () => {
      setupKellyOrders();
      const ctx: RegimeContext = { compositeRegime: CompositeRegimeType.BEAR, riskLevel: 3 };
      const result = await service.allocateCapitalByKelly(400, [createStrategy('s1')], ctx);

      // $400 * 0.1 = $40 effective → below $50 minimum → excluded
      expect(result.size).toBe(0);
    });
  });

  describe('getAllocationDetails', () => {
    it('returns sorted allocation details with percentages and scores', async () => {
      mockScoreRepo.find.mockResolvedValue([createScore('s1', 60), createScore('s2', 90)]);

      const details = await service.getAllocationDetails(10000, [createStrategy('s1'), createStrategy('s2')]);

      expect(details.length).toBe(2);
      // Both get allocation; s2 (score 90) has higher or equal capital
      expect(details[0].strategyConfigId).toBe('s2');
      expect(details[0].score).toBe(90);
      expect(details[0].percentage).toBeGreaterThan(0);
      expect(details[0].allocatedCapital).toBeGreaterThanOrEqual(details[1].allocatedCapital);
    });

    it('returns empty array when no strategies are eligible', async () => {
      mockScoreRepo.find.mockResolvedValue([]);

      const details = await service.getAllocationDetails(10000, [createStrategy('s1')]);

      expect(details).toEqual([]);
    });
  });

  describe('calculateMinimumCapitalRequired', () => {
    it('returns strategy count multiplied by $50 minimum', () => {
      expect(service.calculateMinimumCapitalRequired(1)).toBe(50);
      expect(service.calculateMinimumCapitalRequired(5)).toBe(250);
      expect(service.calculateMinimumCapitalRequired(10)).toBe(500);
    });
  });

  describe('validateCapitalAllocation', () => {
    it('rejects zero or negative capital', () => {
      const result = service.validateCapitalAllocation(0, [createStrategy('s1')]);
      expect(result).toEqual({ valid: false, reason: 'Capital must be greater than 0' });
    });

    it('rejects empty strategy list', () => {
      const result = service.validateCapitalAllocation(10000, []);
      expect(result).toEqual({ valid: false, reason: 'No strategies available for allocation' });
    });

    it('rejects insufficient capital for strategy count', () => {
      const strategies = Array.from({ length: 5 }, (_, i) => createStrategy(`s${i}`));
      const result = service.validateCapitalAllocation(100, strategies);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Minimum capital required');
      expect(result.reason).toContain('$250');
    });

    it('accepts valid capital and strategy combination', () => {
      const result = service.validateCapitalAllocation(10000, [createStrategy('s1')]);
      expect(result).toEqual({ valid: true });
    });
  });
});
