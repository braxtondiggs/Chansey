import { CrossListingScorerService } from './cross-listing-scorer.service';
import { type DefiLlamaClientService } from './defi-llama-client.service';

import { type Coin } from '../../coin/coin.entity';
import { type TickerPairs } from '../../coin/ticker-pairs/ticker-pairs.entity';
import { type ListingCandidate } from '../entities/listing-candidate.entity';

type Repo = {
  createQueryBuilder: jest.Mock;
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
};

function makeQb(result: unknown[]) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(result)
  };
  return qb;
}

function buildCoin(overrides: Partial<Coin> = {}): Coin {
  return {
    id: `coin-${overrides.symbol ?? 'x'}`,
    symbol: 'foo',
    name: 'Foo',
    slug: 'foo',
    marketRank: 200,
    priceChangePercentage7d: 10,
    communityScore: 50,
    publicInterestScore: 50,
    sentimentUp: 50,
    ...overrides
  } as Coin;
}

function buildTicker(slug: string): TickerPairs {
  return { exchange: { slug } } as TickerPairs;
}

function makeRepos(tickers: TickerPairs[], existingCandidate?: ListingCandidate | null) {
  const coinRepo: Repo = {
    createQueryBuilder: jest.fn().mockImplementation(() => makeQb([])),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn()
  };
  const tickerRepo: Repo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn().mockResolvedValue(tickers),
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn()
  };
  const candidateRepo: Repo = {
    createQueryBuilder: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn().mockResolvedValue(existingCandidate ?? null),
    save: jest.fn().mockImplementation((c) => Promise.resolve(c)),
    create: jest.fn().mockImplementation((c) => c as ListingCandidate)
  };
  return { coinRepo, tickerRepo, candidateRepo };
}

describe('CrossListingScorerService', () => {
  let defiLlama: jest.Mocked<Pick<DefiLlamaClientService, 'getTvlGrowthPercent'>>;

  beforeEach(() => {
    defiLlama = { getTvlGrowthPercent: jest.fn().mockResolvedValue(10) } as any;
  });

  function makeService(tickers: TickerPairs[], threshold = 0) {
    const { coinRepo, tickerRepo, candidateRepo } = makeRepos(tickers);
    const service = new CrossListingScorerService(
      coinRepo as any,
      tickerRepo as any,
      candidateRepo as any,
      defiLlama as any,
      { get: jest.fn().mockReturnValue(String(threshold)) } as any
    );
    return { service, coinRepo, tickerRepo, candidateRepo };
  }

  it('returns null when coin is listed on a major exchange', async () => {
    const tickers = [buildTicker('binance'), buildTicker('kucoin'), buildTicker('gate'), buildTicker('okx')];
    const { service } = makeService(tickers);
    const result = await service.scoreCoin(buildCoin());
    expect(result).toBeNull();
  });

  it('returns null when fewer than 3 target exchanges are present', async () => {
    const tickers = [buildTicker('kucoin'), buildTicker('gate')];
    const { service } = makeService(tickers);
    expect(await service.scoreCoin(buildCoin())).toBeNull();
  });

  it('applies Kraken 1.5x multiplier when present', async () => {
    const krakenTickers = [buildTicker('kucoin'), buildTicker('gate'), buildTicker('okx'), buildTicker('kraken')];
    const { service: sKraken } = makeService(krakenTickers);
    const withKraken = await sKraken.scoreCoin(buildCoin());

    const noKrakenTickers = [buildTicker('kucoin'), buildTicker('gate'), buildTicker('okx')];
    const { service: sNo } = makeService(noKrakenTickers);
    const withoutKraken = await sNo.scoreCoin(buildCoin());

    if (!withKraken || !withoutKraken) throw new Error('expected both results to be non-null');
    expect(withKraken.breakdown.crossListingCount).toBeGreaterThan(withoutKraken.breakdown.crossListingCount);
    expect(withKraken.breakdown.krakenListed).toBe(true);
    expect(withoutKraken.breakdown.krakenListed).toBe(false);
  });

  it('redistributes social weight when CoinGecko fields are missing', async () => {
    const tickers = [buildTicker('kucoin'), buildTicker('gate'), buildTicker('okx')];
    const { service } = makeService(tickers);
    const result = await service.scoreCoin(
      buildCoin({ communityScore: null, publicInterestScore: null, sentimentUp: null } as Partial<Coin>)
    );
    if (!result) throw new Error('expected result to be non-null');
    const w = result.breakdown.weights;
    expect(w.socialVelocity).toBe(0);
    const total = w.tvlGrowth90d + w.crossListingCount + w.categoryMomentum + w.marketCapRank;
    expect(total).toBeCloseTo(1, 3);
    expect(result.breakdown.socialDataAvailable).toBe(false);
  });

  it('uses CoinGecko social fields when present', async () => {
    const tickers = [buildTicker('kucoin'), buildTicker('gate'), buildTicker('okx')];
    const { service } = makeService(tickers);
    const result = await service.scoreCoin(buildCoin({ communityScore: 80, publicInterestScore: 60, sentimentUp: 70 }));
    if (!result) throw new Error('expected result to be non-null');
    // Weighted avg: (80*0.4 + 60*0.3 + 70*0.3) / (0.4 + 0.3 + 0.3) = (32 + 18 + 21) / 1 = 71
    expect(result.breakdown.socialVelocity).toBeCloseTo(71, 5);
    expect(result.breakdown.socialDataAvailable).toBe(true);
  });

  it('gives sweet-spot market-cap ranks a score of 100', async () => {
    const tickers = [buildTicker('kucoin'), buildTicker('gate'), buildTicker('okx')];
    const { service } = makeService(tickers);
    const sweetSpot = await service.scoreCoin(buildCoin({ marketRank: 200 }));
    const tooSmall = await service.scoreCoin(buildCoin({ marketRank: 1500 }));
    if (!sweetSpot || !tooSmall) throw new Error('expected both results to be non-null');
    expect(sweetSpot.breakdown.marketCapRank).toBe(100);
    expect(tooSmall.breakdown.marketCapRank).toBe(0);
  });

  it('qualifies candidates above the configured threshold', async () => {
    const tickers = [buildTicker('kucoin'), buildTicker('gate'), buildTicker('okx'), buildTicker('kraken')];
    const { service } = makeService(tickers, 50);
    const result = await service.scoreCoin(buildCoin());
    if (!result) throw new Error('expected result to be non-null');
    expect(result.qualified).toBe(result.score >= 50);
  });

  it('scoreAll bulk-fetches ticker slugs once (no N+1)', async () => {
    const { coinRepo, tickerRepo, candidateRepo } = makeRepos([]);
    const coins = [
      buildCoin({ id: 'c1', symbol: 'aaa' } as Partial<Coin>),
      buildCoin({ id: 'c2', symbol: 'bbb' } as Partial<Coin>),
      buildCoin({ id: 'c3', symbol: 'ccc' } as Partial<Coin>)
    ];
    coinRepo.createQueryBuilder = jest.fn().mockImplementation(() => makeQb(coins));

    const tickerQb: any = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { coinId: 'c1', slug: 'kucoin' },
        { coinId: 'c1', slug: 'gate' },
        { coinId: 'c1', slug: 'okx' },
        { coinId: 'c2', slug: 'kucoin' },
        { coinId: 'c2', slug: 'gate' },
        { coinId: 'c2', slug: 'okx' },
        { coinId: 'c2', slug: 'kraken' },
        { coinId: 'c3', slug: 'binance' }
      ])
    };
    tickerRepo.createQueryBuilder = jest.fn().mockReturnValue(tickerQb);

    const service = new CrossListingScorerService(
      coinRepo as any,
      tickerRepo as any,
      candidateRepo as any,
      defiLlama as any,
      { get: jest.fn().mockReturnValue('0') } as any
    );

    const results = await service.scoreAll();

    expect(tickerRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
    expect(tickerRepo.find).not.toHaveBeenCalled();
    // c1 (3 targets) and c2 (3 targets + kraken) pass the cross-listing gate; c3 is on binance and is filtered out
    expect(results.map((r) => r.coinId).sort()).toEqual(['c1', 'c2']);
  });
});
