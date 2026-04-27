import type { Repository } from 'typeorm';

import type { CoinDiversityService } from './coin-diversity.service';
import { selectCoinsByRiskLevel } from './coin-risk-selection';
import type { Coin } from './coin.entity';

const createTestCoin = (overrides: Partial<Coin> & Record<string, unknown> = {}): Coin => {
  const now = new Date();
  return {
    id: (overrides.id as string) ?? 'coin-123',
    slug: (overrides.slug as string) ?? 'bitcoin',
    name: (overrides.name as string) ?? 'Bitcoin',
    symbol: (overrides.symbol as string) ?? 'BTC',
    createdAt: (overrides.createdAt as Date) ?? now,
    updatedAt: (overrides.updatedAt as Date) ?? now,
    ...overrides
  } as Coin;
};

const mockQueryBuilder = () => {
  const qb: Record<string, jest.Mock> = {};
  qb.where = jest.fn().mockReturnValue(qb);
  qb.andWhere = jest.fn().mockReturnValue(qb);
  qb.orderBy = jest.fn().mockReturnValue(qb);
  qb.addOrderBy = jest.fn().mockReturnValue(qb);
  qb.take = jest.fn().mockReturnValue(qb);
  qb.getMany = jest.fn().mockResolvedValue([]);
  return qb;
};

const createMockRepo = (qb: ReturnType<typeof mockQueryBuilder>) =>
  ({ createQueryBuilder: jest.fn().mockReturnValue(qb) }) as unknown as Repository<Coin>;

const createMockDiversity = () =>
  ({
    pruneByDiversity: jest.fn((shortlist: Coin[], take: number) => shortlist.slice(0, take))
  }) as unknown as jest.Mocked<Pick<CoinDiversityService, 'pruneByDiversity'>>;

const collectWhereCalls = (qb: Record<string, jest.Mock>): string[] => [
  ...qb.where.mock.calls.map((call: unknown[]) => String(call[0])),
  ...qb.andWhere.mock.calls.map((call: unknown[]) => String(call[0]))
];

describe('selectCoinsByRiskLevel', () => {
  describe('hard filter', () => {
    it('applies the full hard filter (stablecoins, volume, mcap, active mapping) at level 3', async () => {
      const qb = mockQueryBuilder();
      // Return enough coins to trigger the `2 * take` short-circuit so we stay in tier 0.
      qb.getMany.mockResolvedValue(Array.from({ length: 6 }, () => createTestCoin()));
      const repo = createMockRepo(qb);
      const diversity = createMockDiversity();

      await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 2);

      const clauses = collectWhereCalls(qb);
      expect(clauses).toContain('coin.delistedAt IS NULL');
      expect(clauses).toContain('coin.currentPrice IS NOT NULL');
      expect(clauses).toContain('coin.totalVolume >= :minVolume');
      expect(clauses).toContain('UPPER(coin.symbol) NOT IN (:...stablecoins)');
      expect(clauses).toContain('coin.marketCap >= :minMarketCap');
      // default path (no userExchangeIds) requires any active mapping
      expect(clauses.some((c) => c.includes('exchange_symbol_map') && !c.includes('userExchangeIds'))).toBe(true);
      // Oversample: take * SHORTLIST_MULTIPLIER (3) = 6
      expect(qb.take).toHaveBeenCalledWith(6);
    });
  });

  describe('score weighting', () => {
    it('blends a sentiment nudge into the primary score by default', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      const repo = createMockRepo(qb);
      const diversity = createMockDiversity();

      await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 1);

      const orderExpr = String(qb.orderBy.mock.calls[0][0]);
      expect(orderExpr).toContain('sentimentUp');
      expect(orderExpr).toContain('priceChangePercentage7d');
      expect(orderExpr).toContain('priceChangePercentage30d');
    });

    // Score-SQL momentum terms are conditional on per-level weights:
    //   L1: neither (size+liq only)  L2: mo30 only  L3-5: both
    it.each([
      [1, false, false],
      [2, false, true],
      [3, true, true]
    ])('includes momentum terms per level weights (level %i → mo7=%s, mo30=%s)', async (level, has7d, has30d) => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      const repo = createMockRepo(qb);
      const diversity = createMockDiversity();

      await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, level, 1);

      const orderExpr = String(qb.orderBy.mock.calls[0][0]);
      expect(orderExpr.includes('priceChangePercentage7d')).toBe(has7d);
      expect(orderExpr.includes('priceChangePercentage30d')).toBe(has30d);
    });
  });

  describe('OHLC tradability', () => {
    // Both EXISTS branches (user-scoped and any-exchange) must enforce the OHLC
    // freshness + non-zero-volume invariant — coins with an active symbol map
    // but no recent candles cannot be priced and must be excluded.
    it.each<[string, string[] | undefined, Record<string, unknown>]>([
      ['user-exchange', ['ex-a'], { userExchangeIds: ['ex-a'], freshnessHours: 24 }],
      ['any-exchange', undefined, { freshnessHours: 24 }]
    ])('requires recent non-zero-volume OHLC on the %s branch', async (_label, userExchangeIds, expectedBindings) => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      const repo = createMockRepo(qb);
      const diversity = createMockDiversity();

      await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 1, userExchangeIds);

      const existsClause = qb.andWhere.mock.calls.find((call: unknown[]) => {
        if (typeof call[0] !== 'string' || !call[0].includes('exchange_symbol_map')) return false;
        return userExchangeIds ? call[0].includes('userExchangeIds') : !call[0].includes('userExchangeIds');
      });
      expect(existsClause).toBeDefined();
      const sql = String(existsClause?.[0] ?? '');
      expect(sql).toContain('ohlc_candles');
      expect(sql).toContain('oc.timestamp');
      expect(sql).toContain(':freshnessHours');
      expect(sql).toContain('oc.volume > 0');
      expect(existsClause?.[1]).toEqual(expectedBindings);
    });
  });

  describe('level-specific filters', () => {
    it('applies the mid-cap band at level 5', async () => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      const repo = createMockRepo(qb);
      const diversity = createMockDiversity();

      await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 5, 1);

      expect(qb.andWhere).toHaveBeenCalledWith('coin.marketCap BETWEEN :l5Min AND :l5Max', {
        l5Min: 50_000_000,
        l5Max: 5_000_000_000
      });
    });
  });

  describe('fallback chain', () => {
    it('runs exactly two fallback tiers: strict mcap floor then dropMcapFloor', async () => {
      const calls: Array<{ clauses: string[] }> = [];
      const repo = {
        createQueryBuilder: jest.fn().mockImplementation(() => {
          const qb = mockQueryBuilder();
          qb.getMany.mockImplementation(() => {
            const clauses = collectWhereCalls(qb);
            calls.push({ clauses });
            // Return empty arrays every time — forces both tiers to run.
            return Promise.resolve([]);
          });
          return qb;
        })
      } as unknown as Repository<Coin>;
      const diversity = createMockDiversity();

      await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 5);

      expect(calls.length).toBe(2);
      // Tier 0: strict mcap floor
      expect(calls[0].clauses).toContain('coin.marketCap >= :minMarketCap');
      // Tier 1: relaxed (mcap not null)
      expect(calls[1].clauses).not.toContain('coin.marketCap >= :minMarketCap');
      expect(calls[1].clauses).toContain('coin.marketCap IS NOT NULL');
    });

    it('short-circuits the loop when tier 0 returns at least 2 * take coins and invokes diversity pruning', async () => {
      let attempt = 0;
      const shortlist = Array.from({ length: 6 }, (_, i) => createTestCoin({ id: `c${i}` }));
      const repo = {
        createQueryBuilder: jest.fn().mockImplementation(() => {
          const qb = mockQueryBuilder();
          qb.getMany.mockImplementation(() => {
            attempt++;
            return Promise.resolve(shortlist);
          });
          return qb;
        })
      } as unknown as Repository<Coin>;
      const diversity = createMockDiversity();

      const result = await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 2);

      expect(attempt).toBe(1);
      expect(diversity.pruneByDiversity).toHaveBeenCalledWith(shortlist, 2);
      expect(result).toHaveLength(2);
    });

    it('keeps iterating when tier 0 returns fewer than 2 * take and succeeds at tier 1', async () => {
      let attempt = 0;
      const thinPool = [createTestCoin({ id: 'a' }), createTestCoin({ id: 'b' })];
      const widePool = Array.from({ length: 6 }, (_, i) => createTestCoin({ id: `w${i}` }));
      const repo = {
        createQueryBuilder: jest.fn().mockImplementation(() => {
          const qb = mockQueryBuilder();
          qb.getMany.mockImplementation(() => {
            attempt++;
            return Promise.resolve(attempt === 1 ? thinPool : widePool);
          });
          return qb;
        })
      } as unknown as Repository<Coin>;
      const diversity = createMockDiversity();

      const result = await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 2);

      expect(attempt).toBe(2);
      expect(diversity.pruneByDiversity).toHaveBeenCalledWith(widePool, 2);
      expect(result).toHaveLength(2);
    });

    it('prunes the best shortlist from a lower tier when no tier hit 2 * take but at least one reached take', async () => {
      const thinPool = [createTestCoin({ id: 'a' }), createTestCoin({ id: 'b' })];
      const repo = {
        createQueryBuilder: jest.fn().mockImplementation(() => {
          const qb = mockQueryBuilder();
          qb.getMany.mockResolvedValue(thinPool);
          return qb;
        })
      } as unknown as Repository<Coin>;
      const diversity = createMockDiversity();

      const result = await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 2);

      expect(diversity.pruneByDiversity).toHaveBeenCalledWith(thinPool, 2);
      expect(result).toHaveLength(2);
    });

    it('skips diversity pruning entirely when the shortlist is thinner than take', async () => {
      const starved = [createTestCoin({ id: 'only' })];
      const repo = {
        createQueryBuilder: jest.fn().mockImplementation(() => {
          const qb = mockQueryBuilder();
          qb.getMany.mockResolvedValue(starved);
          return qb;
        })
      } as unknown as Repository<Coin>;
      const diversity = createMockDiversity();

      const result = await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, 3, 5);

      expect(diversity.pruneByDiversity).not.toHaveBeenCalled();
      expect(result).toEqual(starved);
    });
  });

  // Shadow-registered CoinService instances (users, order, algorithm, exchange
  // modules) run without the optional diversity service — verify both
  // post-query pruning branches degrade to a plain slice.
  describe('optional diversity service', () => {
    it('slices to take without pruning when diversity service is undefined (tier-0 short-circuit)', async () => {
      const shortlist = Array.from({ length: 6 }, (_, i) => createTestCoin({ id: `c${i}` }));
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue(shortlist);
      const repo = createMockRepo(qb);

      const result = await selectCoinsByRiskLevel(repo, undefined, 3, 2);

      expect(result).toHaveLength(2);
      expect(result).toEqual(shortlist.slice(0, 2));
    });

    it('slices the best lower-tier shortlist without pruning when diversity service is undefined', async () => {
      const thinPool = [createTestCoin({ id: 'a' }), createTestCoin({ id: 'b' })];
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue(thinPool);
      const repo = createMockRepo(qb);

      const result = await selectCoinsByRiskLevel(repo, undefined, 3, 2);

      // Both tiers returned the same thin pool; lastResult.length === take, so
      // the function takes the slice path on the relaxed-tier fallback.
      expect(result).toHaveLength(2);
      expect(result).toEqual(thinPool.slice(0, 2));
    });
  });

  // Verifies the actual clamped level by inspecting query shape:
  //   - level 1 omits momentum terms in the orderBy SQL
  //   - level 5 applies the mid-cap BETWEEN band
  //   - levels 2–4 include momentum terms but no mid-cap band
  describe('level clamping', () => {
    it.each([
      [-1, 1],
      [0, 3], // 0 is falsy → falls back to default level 3
      [6, 5],
      [99, 5],
      [NaN, 3] // NaN is falsy → falls back to default level 3
    ])('clamps out-of-range level %p to effective level %p', async (input, expected) => {
      const qb = mockQueryBuilder();
      qb.getMany.mockResolvedValue([createTestCoin()]);
      const repo = createMockRepo(qb);
      const diversity = createMockDiversity();

      await selectCoinsByRiskLevel(repo, diversity as unknown as CoinDiversityService, input, 1);

      const orderExpr = String(qb.orderBy.mock.calls[0][0]);
      if (expected === 1) {
        expect(orderExpr).not.toContain('priceChangePercentage7d');
        expect(orderExpr).not.toContain('priceChangePercentage30d');
      } else {
        expect(orderExpr).toContain('priceChangePercentage7d');
      }

      const hasMidCapBand = qb.andWhere.mock.calls.some((call: unknown[]) =>
        String(call[0]).includes('coin.marketCap BETWEEN :l5Min AND :l5Max')
      );
      expect(hasMidCapBand).toBe(expected === 5);
    });
  });
});
