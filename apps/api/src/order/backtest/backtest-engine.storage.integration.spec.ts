import { BacktestEngine } from './backtest-engine.service';
import { MarketDataReaderService } from './market-data-reader.service';

describe('BacktestEngine storage flow', () => {
  it('loads CSV-backed market data and runs the backtest loop', async () => {
    const csv = [
      'timestamp,open,high,low,close,volume,symbol',
      '2024-01-01T00:00:00Z,100,105,95,102,1000,BTC',
      '2024-01-01T01:00:00Z,102,110,101,108,1100,BTC'
    ].join('\n');

    const storageService = {
      getFileStats: jest.fn().mockResolvedValue({ size: Buffer.byteLength(csv) }),
      getFile: jest.fn().mockResolvedValue(Buffer.from(csv))
    };
    const marketDataReader = new MarketDataReaderService(storageService as any);

    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({
        success: false,
        signals: [],
        timestamp: new Date()
      })
    };

    const ohlcService = {
      getCandlesByDateRange: jest.fn()
    };

    const engine = new BacktestEngine(
      { publishMetric: jest.fn(), publishStatus: jest.fn() } as any,
      algorithmRegistry as any,
      { getCoinBySymbol: jest.fn().mockResolvedValue({ id: 'USD', symbol: 'USD' }) } as any,
      ohlcService as any,
      marketDataReader
    );

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'backtest-1',
        name: 'CSV Backtest',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-01T02:00:00Z'),
        algorithm: { id: 'algo-1' }
      } as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        deterministicSeed: 'seed',
        dataset: {
          id: 'dataset-1',
          storageLocation: 'datasets/btc.csv',
          instrumentUniverse: ['BTC'],
          startAt: new Date('2024-01-01T00:00:00Z'),
          endAt: new Date('2024-01-01T02:00:00Z')
        } as any
      }
    );

    expect(storageService.getFileStats).toHaveBeenCalledWith('datasets/btc.csv');
    expect(storageService.getFile).toHaveBeenCalledWith('datasets/btc.csv');
    expect(ohlcService.getCandlesByDateRange).not.toHaveBeenCalled();
    expect(result.snapshots.length).toBeGreaterThan(0);
  });
});
