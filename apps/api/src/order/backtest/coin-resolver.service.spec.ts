import { CoinResolverService } from './coin-resolver.service';
import { MarketDataSet } from './market-data-set.entity';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';

describe('CoinResolverService', () => {
  const createDataset = (overrides: Partial<MarketDataSet>): MarketDataSet =>
    ({
      id: 'dataset-1',
      instrumentUniverse: [],
      ...overrides
    }) as MarketDataSet;

  const createCoin = (symbol: string): Coin =>
    ({
      id: symbol,
      symbol,
      name: symbol,
      slug: symbol.toLowerCase()
    }) as Coin;

  const createService = (coinService: Partial<CoinService>) => new CoinResolverService(coinService as CoinService);

  it('returns instrument_universe_truncated warning when resolved exceeds maxInstruments', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase())))
    };
    const service = createService(coinService);
    const dataset = createDataset({
      instrumentUniverse: ['BTC', 'ETH', 'SOL'],
      maxInstruments: 2
    });

    const result = await service.resolveCoins(dataset);

    expect(result.coins).toHaveLength(2);
    expect(result.warnings).toContain('instrument_universe_truncated');
  });

  it('respects custom maxInstruments values', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase())))
    };
    const service = createService(coinService);
    const dataset = createDataset({
      instrumentUniverse: ['BTC', 'ETH'],
      maxInstruments: 1
    });

    const result = await service.resolveCoins(dataset);

    expect(result.coins).toHaveLength(1);
    expect(result.warnings).toContain('instrument_universe_truncated');
  });

  it('uses default 50 when maxInstruments is null', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase())))
    };
    const service = createService(coinService);
    const instruments = Array.from({ length: 55 }, (_, index) => `COIN${index}`);
    const dataset = createDataset({
      instrumentUniverse: instruments,
      maxInstruments: null as unknown as number
    });

    const result = await service.resolveCoins(dataset);

    expect(result.coins).toHaveLength(50);
    expect(result.warnings).toContain('instrument_universe_truncated');
  });

  it('resolves base symbols for trading pairs while preserving order', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => {
        if (symbols.includes('BTC')) {
          return [createCoin('BTC')];
        }

        return symbols.filter((symbol) => ['ETH', 'SOL'].includes(symbol)).map((symbol) => createCoin(symbol));
      })
    };
    const service = createService(coinService);
    const dataset = createDataset({
      instrumentUniverse: ['ETHUSDT', 'BTC', 'SOLUSD']
    });

    const result = await service.resolveCoins(dataset);

    expect(result.coins.map((coin) => coin.symbol)).toEqual(['ETH', 'BTC', 'SOL']);
    expect(result.warnings).toEqual([]);
  });

  it('throws when instrument universe is empty', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async () => [])
    };
    const service = createService(coinService);
    const dataset = createDataset({
      instrumentUniverse: []
    });

    await expect(service.resolveCoins(dataset)).rejects.toBeInstanceOf(InstrumentUniverseUnresolvedException);
  });

  it('rejects base symbols shorter than 3 characters', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async () => [])
    };
    const service = createService(coinService);
    const dataset = createDataset({ instrumentUniverse: ['WBTC', 'STETH'] });

    await expect(service.resolveCoins(dataset)).rejects.toBeInstanceOf(InstrumentUniverseUnresolvedException);
  });

  it('resolves base symbols that are exactly 3 characters', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) =>
        symbols.includes('ABC') ? [createCoin('ABC')] : []
      )
    };
    const service = createService(coinService);
    const dataset = createDataset({ instrumentUniverse: ['ABCUSD'] });

    const result = await service.resolveCoins(dataset);

    expect(result.coins.map((coin) => coin.symbol)).toEqual(['ABC']);
    expect(result.warnings).toEqual([]);
  });
});
