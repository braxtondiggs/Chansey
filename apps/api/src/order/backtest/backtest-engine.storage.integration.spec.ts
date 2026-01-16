import { BacktestEngine } from './backtest-engine.service';
import { MarketDataReaderService } from './market-data-reader.service';

import { SignalType } from '../../algorithm/interfaces';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';

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
      executeAlgorithm: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          signals: [
            {
              type: SignalType.BUY,
              coinId: 'BTC',
              strength: 0.5,
              quantity: 1,
              confidence: 0.9,
              reason: 'signal',
              metadata: { source: 'csv' }
            }
          ],
          timestamp: new Date()
        })
        .mockResolvedValueOnce({
          success: true,
          signals: [],
          timestamp: new Date()
        })
    };

    const ohlcService = {
      getCandlesByDateRange: jest.fn()
    };

    const quoteCurrencyResolver = {
      resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdc', symbol: 'USDC' })
    };

    const engine = new BacktestEngine(
      { publishMetric: jest.fn(), publishStatus: jest.fn() } as any,
      algorithmRegistry as any,
      {} as any,
      ohlcService as any,
      marketDataReader,
      new SharpeRatioCalculator(),
      quoteCurrencyResolver as any
    );

    const result = await engine.executeHistoricalBacktest(
      {
        id: 'backtest-1',
        name: 'CSV Backtest',
        initialCapital: 1000,
        tradingFee: 0,
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-01T02:00:00Z'),
        algorithm: { id: 'algo-1' },
        configSnapshot: {
          parameters: { risk: 'low' },
          run: { quoteCurrency: 'USDC' },
          slippage: { model: 'fixed', fixedBps: 50 }
        }
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
    expect(quoteCurrencyResolver.resolveQuoteCurrency).toHaveBeenCalledWith('USDC');
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledWith(
      'algo-1',
      expect.objectContaining({
        config: { risk: 'low' },
        metadata: expect.objectContaining({
          datasetId: 'dataset-1',
          deterministicSeed: 'seed',
          backtestId: 'backtest-1'
        })
      })
    );
    expect(result.snapshots.length).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].quoteCoin?.symbol).toBe('USDC');
    expect(result.simulatedFills).toHaveLength(1);
    expect(result.simulatedFills[0].slippageBps).toBe(50);
  });
});
