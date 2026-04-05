import { mapCoinGeckoDetailToUpdate } from './map-coingecko-detail.util';

describe('mapCoinGeckoDetailToUpdate', () => {
  const fullCoin = {
    description: { en: 'A cryptocurrency' },
    image: { large: 'https://img/large.png', small: 'https://img/small.png', thumb: 'https://img/thumb.png' },
    genesis_date: '2009-01-03',
    market_cap_rank: 1,
    coingecko_rank: 5,
    developer_score: 80,
    community_score: 70,
    liquidity_score: 60,
    public_interest_score: 50,
    sentiment_votes_up_percentage: 75,
    sentiment_votes_down_percentage: 25,
    market_data: {
      total_supply: 21000000,
      total_volume: { usd: 5000000 },
      circulating_supply: 19000000,
      max_supply: 21000000,
      market_cap: { usd: 1000000000 },
      ath: { usd: 69000 },
      atl: { usd: 0.01 },
      ath_date: { usd: '2021-11-10' },
      atl_date: { usd: '2010-07-17' },
      ath_change_percentage: { usd: -50 },
      atl_change_percentage: { usd: 999999 },
      price_change_24h: -100,
      price_change_percentage_24h: -1.5,
      price_change_percentage_7d: 5.2,
      price_change_percentage_14d: -3.1,
      price_change_percentage_30d: 10,
      price_change_percentage_60d: 15,
      price_change_percentage_200d: 20,
      price_change_percentage_1y: 30,
      market_cap_change_24h: -500000,
      market_cap_change_percentage_24h: -0.5,
      last_updated: '2024-01-01T00:00:00Z'
    }
  };

  it('maps every field from a full CoinGecko response', () => {
    const result = mapCoinGeckoDetailToUpdate(fullCoin, null, 'btc');

    expect(result).toEqual({
      description: 'A cryptocurrency',
      image: 'https://img/large.png',
      genesis: '2009-01-03',
      marketRank: 1,
      geckoRank: 5,
      developerScore: 80,
      communityScore: 70,
      liquidityScore: 60,
      publicInterestScore: 50,
      sentimentUp: 75,
      sentimentDown: 25,
      totalSupply: 21000000,
      totalVolume: 5000000,
      circulatingSupply: 19000000,
      maxSupply: 21000000,
      marketCap: 1000000000,
      ath: 69000,
      atl: 0.01,
      athDate: '2021-11-10',
      atlDate: '2010-07-17',
      athChange: -50,
      atlChange: 999999,
      priceChange24h: -100,
      priceChangePercentage24h: -1.5,
      priceChangePercentage7d: 5.2,
      priceChangePercentage14d: -3.1,
      priceChangePercentage30d: 10,
      priceChangePercentage60d: 15,
      priceChangePercentage200d: 20,
      priceChangePercentage1y: 30,
      marketCapChange24h: -500000,
      marketCapChangePercentage24h: -0.5,
      geckoLastUpdatedAt: '2024-01-01T00:00:00Z'
    });
  });

  it('returns null for every field when given an empty object', () => {
    const result = mapCoinGeckoDetailToUpdate({}, null, 'btc');

    const allNull = Object.fromEntries(Object.keys(result).map((k) => [k, null]));
    expect(result).toEqual(allNull);
  });

  it('uses geckoRank fallback: coin.coingecko_rank ?? geckoRank ?? null', () => {
    expect(mapCoinGeckoDetailToUpdate({ coingecko_rank: 3 }, 10, 'btc').geckoRank).toBe(3);
    expect(mapCoinGeckoDetailToUpdate({}, 10, 'btc').geckoRank).toBe(10);
    expect(mapCoinGeckoDetailToUpdate({}, null, 'btc').geckoRank).toBeNull();
  });

  it('follows image fallback chain: large → small → thumb → null', () => {
    expect(mapCoinGeckoDetailToUpdate({ image: { large: 'L' } }, null, 'x').image).toBe('L');
    expect(mapCoinGeckoDetailToUpdate({ image: { small: 'S', thumb: 'T' } }, null, 'x').image).toBe('S');
    expect(mapCoinGeckoDetailToUpdate({ image: { thumb: 'T' } }, null, 'x').image).toBe('T');
    expect(mapCoinGeckoDetailToUpdate({ image: {} }, null, 'x').image).toBeNull();
  });

  it('handles market_data with only some fields present', () => {
    const coin = { market_data: { total_supply: 100 } };
    const result = mapCoinGeckoDetailToUpdate(coin, null, 'eth');

    expect(result.totalSupply).toBe(100);
    expect(result.totalVolume).toBeNull();
    expect(result.marketCap).toBeNull();
    expect(result.ath).toBeNull();
    expect(result.geckoLastUpdatedAt).toBeNull();
  });
});
