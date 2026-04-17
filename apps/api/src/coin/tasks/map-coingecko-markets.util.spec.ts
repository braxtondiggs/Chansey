import { mapCoinGeckoMarketsToUpdate } from './map-coingecko-markets.util';

describe('mapCoinGeckoMarketsToUpdate', () => {
  const fullEntry = {
    id: 'bitcoin',
    image: 'https://img/large.png',
    current_price: 45000,
    market_cap: 1_000_000_000_000,
    market_cap_rank: 1,
    total_volume: 30_000_000_000,
    circulating_supply: 19_000_000,
    total_supply: 21_000_000,
    max_supply: 21_000_000,
    ath: 69000,
    atl: 0.01,
    ath_date: '2021-11-10',
    atl_date: '2010-07-17',
    ath_change_percentage: -35,
    atl_change_percentage: 999999,
    price_change_24h: -100,
    price_change_percentage_24h: -1.5,
    market_cap_change_24h: -5_000_000_000,
    market_cap_change_percentage_24h: -0.5,
    last_updated: '2024-01-01T00:00:00Z',
    price_change_percentage_7d_in_currency: 5.2,
    price_change_percentage_14d_in_currency: -3.1,
    price_change_percentage_30d_in_currency: 10,
    price_change_percentage_200d_in_currency: 20,
    price_change_percentage_1y_in_currency: 30
  };

  it('maps every field from a full /coins/markets entry', () => {
    const result = mapCoinGeckoMarketsToUpdate(fullEntry, 7, 'btc');

    expect(result).toEqual({
      image: 'https://img/large.png',
      marketRank: 1,
      geckoRank: 7,
      totalSupply: 21_000_000,
      totalVolume: 30_000_000_000,
      circulatingSupply: 19_000_000,
      maxSupply: 21_000_000,
      marketCap: 1_000_000_000_000,
      currentPrice: 45000,
      ath: 69000,
      atl: 0.01,
      athDate: '2021-11-10',
      atlDate: '2010-07-17',
      athChange: -35,
      atlChange: 999999,
      priceChange24h: -100,
      priceChangePercentage24h: -1.5,
      priceChangePercentage7d: 5.2,
      priceChangePercentage14d: -3.1,
      priceChangePercentage30d: 10,
      priceChangePercentage200d: 20,
      priceChangePercentage1y: 30,
      marketCapChange24h: -5_000_000_000,
      marketCapChangePercentage24h: -0.5,
      geckoLastUpdatedAt: '2024-01-01T00:00:00Z'
    });
  });

  it('returns null for every field when given an empty object', () => {
    const result = mapCoinGeckoMarketsToUpdate({}, null, 'btc');

    const allNull = Object.fromEntries(Object.keys(result).map((k) => [k, null]));
    expect(result).toEqual(allNull);
  });

  it('does NOT include metadata fields (description, scores, etc.)', () => {
    const result = mapCoinGeckoMarketsToUpdate(fullEntry, 7, 'btc') as Record<string, unknown>;

    expect(result.description).toBeUndefined();
    expect(result.genesis).toBeUndefined();
    expect(result.developerScore).toBeUndefined();
    expect(result.communityScore).toBeUndefined();
    expect(result.liquidityScore).toBeUndefined();
    expect(result.publicInterestScore).toBeUndefined();
    expect(result.sentimentUp).toBeUndefined();
    expect(result.sentimentDown).toBeUndefined();
  });

  it('falls back to null geckoRank when not provided', () => {
    expect(mapCoinGeckoMarketsToUpdate({}, null, 'x').geckoRank).toBeNull();
    expect(mapCoinGeckoMarketsToUpdate({}, 5, 'x').geckoRank).toBe(5);
  });

  it('sanitizes invalid numeric values to null', () => {
    const result = mapCoinGeckoMarketsToUpdate(
      { current_price: Infinity, market_cap: NaN, total_volume: -1 },
      null,
      'bad'
    );

    expect(result.currentPrice).toBeNull();
    expect(result.marketCap).toBeNull();
    expect(result.totalVolume).toBeNull(); // negative rejected
  });
});
