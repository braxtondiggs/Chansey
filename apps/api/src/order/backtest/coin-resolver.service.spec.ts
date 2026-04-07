import { BadRequestException } from '@nestjs/common';

import { CoinResolverService } from './coin-resolver.service';
import { MarketDataSet } from './market-data-set.entity';

import { Coin } from '../../coin/coin.entity';
import { CoinService } from '../../coin/coin.service';
import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';
import { OHLCService } from '../../ohlc/ohlc.service';

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

  const createService = (coinService: Partial<CoinService>, ohlcService?: Partial<OHLCService>) =>
    new CoinResolverService(coinService as CoinService, (ohlcService ?? {}) as OHLCService);

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

  it('excludes coins without OHLC data in date range', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase()))),
      getCoinsByIdsFilteredAtDate: jest.fn(async (ids: string[]) => ({
        coins: ids.map((id) => createCoin(id)),
        usedHistoricalData: true
      }))
    };
    const ohlcService = {
      getCoinsWithCandleDataInRange: jest.fn(async () => ['BTC', 'ETH'])
    };
    const service = createService(coinService, ohlcService);
    const dataset = createDataset({ instrumentUniverse: ['BTC', 'ETH', 'SOL'] });

    const result = await service.resolveCoins(dataset, {
      startDate: new Date('2022-01-01'),
      endDate: new Date('2022-12-31')
    });

    expect(result.coins.map((c) => c.symbol)).toEqual(['BTC', 'ETH']);
    expect(ohlcService.getCoinsWithCandleDataInRange).toHaveBeenCalledWith(
      new Date('2022-01-01'),
      new Date('2022-12-31'),
      ['BTC', 'ETH', 'SOL']
    );
  });

  it('applies historical quality filter at startDate', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase()))),
      getCoinsByIdsFilteredAtDate: jest.fn(async () => ({
        coins: [createCoin('BTC')],
        usedHistoricalData: true
      }))
    };
    const ohlcService = {
      getCoinsWithCandleDataInRange: jest.fn(async () => ['BTC', 'ETH'])
    };
    const service = createService(coinService, ohlcService);
    const dataset = createDataset({ instrumentUniverse: ['BTC', 'ETH'] });

    const result = await service.resolveCoins(dataset, {
      startDate: new Date('2022-01-01'),
      endDate: new Date('2022-12-31')
    });

    expect(result.coins.map((c) => c.symbol)).toEqual(['BTC']);
    expect(coinService.getCoinsByIdsFilteredAtDate).toHaveBeenCalledWith(
      ['BTC', 'ETH'],
      new Date('2022-01-01'),
      100_000_000,
      1_000_000
    );
  });

  it('skips date filtering when no dates provided', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase()))),
      getCoinsByIdsFilteredAtDate: jest.fn()
    };
    const ohlcService = {
      getCoinsWithCandleDataInRange: jest.fn()
    };
    const service = createService(coinService, ohlcService);
    const dataset = createDataset({ instrumentUniverse: ['BTC', 'ETH'] });

    const result = await service.resolveCoins(dataset);

    expect(result.coins).toHaveLength(2);
    expect(ohlcService.getCoinsWithCandleDataInRange).not.toHaveBeenCalled();
    expect(coinService.getCoinsByIdsFilteredAtDate).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when requireConfirmation is true and truncation would occur', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase())))
    };
    const service = createService(coinService);
    const dataset = createDataset({
      instrumentUniverse: ['BTC', 'ETH', 'SOL'],
      maxInstruments: 2
    });

    await expect(service.resolveCoins(dataset, { requireConfirmation: true })).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('filters coins by symbolFilter option', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase())))
    };
    const service = createService(coinService);
    const dataset = createDataset({ instrumentUniverse: ['BTC', 'ETH', 'SOL'] });

    const result = await service.resolveCoins(dataset, { symbolFilter: ['BTC', 'SOL'] });

    expect(result.coins.map((c) => c.symbol)).toEqual(['BTC', 'SOL']);
  });

  it('respects custom maxInstruments values', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) => symbols.map((s) => createCoin(s.toUpperCase())))
    };
    const service = createService(coinService);
    const dataset = createDataset({
      instrumentUniverse: ['BTC', 'ETH', 'SOL'],
      maxInstruments: 1
    });

    const result = await service.resolveCoins(dataset);

    expect(result.coins).toHaveLength(1);
    expect(result.coins[0].symbol).toBe('BTC');
    expect(result.warnings).toContain('instrument_universe_truncated');
  });

  it('resolves partial universe without throwing', async () => {
    const coinService = {
      getMultipleCoinsBySymbol: jest.fn(async (symbols: string[]) =>
        symbols.filter((s) => s === 'BTC').map((s) => createCoin(s))
      )
    };
    const service = createService(coinService);
    const dataset = createDataset({ instrumentUniverse: ['BTC', 'FAKECOIN'] });

    const result = await service.resolveCoins(dataset);

    expect(result.coins).toHaveLength(1);
    expect(result.coins[0].symbol).toBe('BTC');
    expect(result.warnings).toEqual([]);
  });
});
