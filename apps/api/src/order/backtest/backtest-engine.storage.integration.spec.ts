import { Readable } from 'stream';

import { BacktestEngine } from './backtest-engine.service';
import { MarketDataReaderService } from './market-data-reader.service';
import {
  FeeCalculatorService,
  MetricsCalculatorService,
  PortfolioStateService,
  PositionManagerService,
  SlippageService
} from './shared';

import { SignalType } from '../../algorithm/interfaces';
import { DrawdownCalculator } from '../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';

// Create shared service instances for tests
const sharpeCalculator = new SharpeRatioCalculator();
const drawdownCalculator = new DrawdownCalculator();
const slippageService = new SlippageService();
const feeCalculator = new FeeCalculatorService();
const positionManager = new PositionManagerService();
const metricsCalculator = new MetricsCalculatorService(sharpeCalculator, drawdownCalculator);
const portfolioState = new PortfolioStateService();

describe('BacktestEngine storage flow', () => {
  /** Build a MarketDataReaderService backed by a mock storage that streams the given CSV */
  const createCSVReader = (csv: string) => {
    const storageService = {
      getFileStats: jest.fn().mockResolvedValue({ size: Buffer.byteLength(csv) }),
      getFileStream: jest.fn().mockResolvedValue(Readable.from([csv]))
    };
    return { marketDataReader: new MarketDataReaderService(storageService as any), storageService };
  };

  /** Build a MarketDataReaderService with no-op storage (for DB-fallback tests) */
  const createEmptyReader = () => {
    const storageService = {
      getFileStats: jest.fn(),
      getFileStream: jest.fn()
    };
    return { marketDataReader: new MarketDataReaderService(storageService as any), storageService };
  };

  const createEngine = (overrides?: {
    algorithmRegistry?: any;
    ohlcService?: any;
    marketDataReader?: MarketDataReaderService;
    quoteCurrencyResolver?: any;
  }) => {
    const algorithmRegistry =
      overrides?.algorithmRegistry ??
      ({ executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] }) } as any);
    const ohlcService = overrides?.ohlcService ?? ({ getCandlesByDateRange: jest.fn() } as any);
    const marketDataReader = overrides?.marketDataReader ?? ({} as MarketDataReaderService);
    const quoteCurrencyResolver =
      overrides?.quoteCurrencyResolver ??
      ({ resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' }) } as any);

    return new BacktestEngine(
      { publishMetric: jest.fn(), publishStatus: jest.fn() } as any,
      algorithmRegistry,
      ohlcService,
      marketDataReader,
      quoteCurrencyResolver,
      slippageService,
      feeCalculator,
      positionManager,
      metricsCalculator,
      portfolioState
    );
  };

  /** Minimal backtest entity shape */
  const baseBacktest = (overrides?: Partial<Record<string, any>>) => ({
    id: 'backtest-1',
    name: 'Test Backtest',
    initialCapital: 1000,
    tradingFee: 0,
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2024-01-01T02:00:00Z'),
    algorithm: { id: 'algo-1' },
    configSnapshot: {
      parameters: {},
      run: {},
      slippage: { model: 'fixed', fixedBps: 5 }
    },
    ...overrides
  });

  it('loads CSV-backed market data and runs the backtest loop', async () => {
    const csv = [
      'timestamp,open,high,low,close,volume,symbol',
      '2024-01-01T00:00:00Z,100,105,95,102,1000,BTC',
      '2024-01-01T01:00:00Z,102,110,101,108,1100,BTC'
    ].join('\n');

    const { marketDataReader, storageService } = createCSVReader(csv);

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

    const ohlcService = { getCandlesByDateRange: jest.fn() };
    const quoteCurrencyResolver = {
      resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdc', symbol: 'USDC' })
    };

    const engine = createEngine({ algorithmRegistry, ohlcService, marketDataReader, quoteCurrencyResolver });

    const result = await engine.executeHistoricalBacktest(
      baseBacktest({
        configSnapshot: {
          parameters: { risk: 'low' },
          run: { quoteCurrency: 'USDC' },
          slippage: { model: 'fixed', fixedBps: 50 }
        }
      }) as any,
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

    // Verify storage path was used (not database)
    expect(storageService.getFileStats).toHaveBeenCalledWith('datasets/btc.csv');
    expect(storageService.getFileStream).toHaveBeenCalledWith('datasets/btc.csv');
    expect(ohlcService.getCandlesByDateRange).not.toHaveBeenCalled();

    // Verify quote currency resolution
    expect(quoteCurrencyResolver.resolveQuoteCurrency).toHaveBeenCalledWith('USDC');

    // Verify algorithm was called for each timestamp with correct context
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

    // Verify result structure
    expect(result.snapshots.length).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].quoteCoin?.symbol).toBe('USDC');
    expect(result.simulatedFills).toHaveLength(1);
    expect(result.simulatedFills[0].slippageBps).toBe(50);
  });

  it('falls back to database candles when dataset has no storage location', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    const startDate = new Date('2024-01-01T00:00:00Z');
    const endDate = new Date('2024-01-01T02:00:00Z');
    const candles = [
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: startDate,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000
      }),
      new OHLCCandle({
        coinId: 'BTC',
        exchangeId: 'exchange-1',
        timestamp: new Date('2024-01-01T01:00:00Z'),
        open: 105,
        high: 115,
        low: 95,
        close: 108,
        volume: 1200
      })
    ];

    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue(candles) };
    const { marketDataReader, storageService } = createEmptyReader();
    const quoteCurrencyResolver = {
      resolveQuoteCurrency: jest.fn().mockResolvedValue({ id: 'usdt', symbol: 'USDT' })
    };

    const engine = createEngine({ algorithmRegistry, ohlcService, marketDataReader, quoteCurrencyResolver });

    const result = await engine.executeHistoricalBacktest(
      baseBacktest({ id: 'backtest-db', name: 'DB Backtest', startDate, endDate }) as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        deterministicSeed: 'seed',
        dataset: {
          id: 'dataset-2',
          storageLocation: '',
          instrumentUniverse: ['BTC'],
          startAt: startDate,
          endAt: endDate
        } as any
      }
    );

    expect(ohlcService.getCandlesByDateRange).toHaveBeenCalledWith(['BTC'], startDate, endDate);
    expect(storageService.getFileStats).not.toHaveBeenCalled();
    expect(storageService.getFileStream).not.toHaveBeenCalled();
    expect(quoteCurrencyResolver.resolveQuoteCurrency).toHaveBeenCalledWith('USDT');
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(2);
    expect(result.snapshots).toHaveLength(2);
    expect(result.trades).toHaveLength(0);
  });

  it('throws when algorithm relation is not loaded', async () => {
    const { marketDataReader } = createEmptyReader();
    const engine = createEngine({ marketDataReader });

    await expect(
      engine.executeHistoricalBacktest(
        baseBacktest({ algorithm: undefined }) as any,
        [{ id: 'BTC', symbol: 'BTC' } as any],
        {
          deterministicSeed: 'seed',
          dataset: { id: 'ds', storageLocation: '', instrumentUniverse: ['BTC'] } as any
        }
      )
    ).rejects.toThrow('Backtest algorithm relation not loaded');
  });

  it('throws when no historical price data is available', async () => {
    const ohlcService = { getCandlesByDateRange: jest.fn().mockResolvedValue([]) };
    const { marketDataReader } = createEmptyReader();
    const engine = createEngine({ ohlcService, marketDataReader });

    await expect(
      engine.executeHistoricalBacktest(baseBacktest() as any, [{ id: 'BTC', symbol: 'BTC' } as any], {
        deterministicSeed: 'seed',
        dataset: {
          id: 'dataset-empty',
          storageLocation: '',
          instrumentUniverse: ['BTC'],
          startAt: new Date('2024-01-01'),
          endAt: new Date('2024-01-02')
        } as any
      })
    ).rejects.toThrow('No historical price data available');
  });
});
