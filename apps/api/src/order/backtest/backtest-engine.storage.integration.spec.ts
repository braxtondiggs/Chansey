import { Readable } from 'stream';

import { BacktestEngine } from './backtest-engine.service';
import { MarketDataReaderService } from './market-data-reader.service';
import {
  FeeCalculatorService,
  MetricsCalculatorService,
  PortfolioStateService,
  PositionManagerService,
  SignalThrottleService,
  SlippageService
} from './shared';

import { SignalType } from '../../algorithm/interfaces';
import { AlgorithmNotRegisteredException } from '../../common/exceptions';
import { DrawdownCalculator } from '../../common/metrics/drawdown.calculator';
import { SharpeRatioCalculator } from '../../common/metrics/sharpe-ratio.calculator';
import { OHLCCandle } from '../../ohlc/ohlc-candle.entity';
import { PositionAnalysisService } from '../services/position-analysis.service';

// Create shared service instances for tests
const sharpeCalculator = new SharpeRatioCalculator();
const drawdownCalculator = new DrawdownCalculator();
const slippageService = new SlippageService();
const feeCalculator = new FeeCalculatorService();
const positionManager = new PositionManagerService();
const metricsCalculator = new MetricsCalculatorService(sharpeCalculator, drawdownCalculator);
const portfolioState = new PortfolioStateService();
const signalThrottle = new SignalThrottleService();

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
      portfolioState,
      new PositionAnalysisService(),
      signalThrottle
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

  /** Helper: create a 2-row BTC CSV */
  const twoRowCsv = () =>
    [
      'timestamp,open,high,low,close,volume,symbol',
      '2024-01-01T00:00:00Z,100,105,95,102,1000,BTC',
      '2024-01-01T01:00:00Z,102,110,101,108,1100,BTC'
    ].join('\n');

  it('reads CSV from storage and produces trades matching signal count', async () => {
    const { marketDataReader, storageService } = createCSVReader(twoRowCsv());

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

    // Storage path was used, not database
    expect(storageService.getFileStats).toHaveBeenCalledWith('datasets/btc.csv');
    expect(storageService.getFileStream).toHaveBeenCalledWith('datasets/btc.csv');
    expect(ohlcService.getCandlesByDateRange).not.toHaveBeenCalled();

    // Quote currency resolved from configSnapshot
    expect(quoteCurrencyResolver.resolveQuoteCurrency).toHaveBeenCalledWith('USDC');

    // Algorithm invoked once per timestamp with config & metadata passthrough
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

    // One BUY signal → exactly one trade and one fill
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].quoteCoin?.symbol).toBe('USDC');
    expect(result.simulatedFills).toHaveLength(1);
    expect(result.simulatedFills[0].slippageBps).toBe(50);
    // 2 timestamps with every-24th snapshots → both timestamps captured (indices 0 and 1 are both < 24)
    expect(result.snapshots).toHaveLength(2);
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

  it('aborts after 10 consecutive algorithm failures', async () => {
    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockRejectedValue(new Error('algo crash'))
    };

    // Need enough candles to reach 10 failures — generate 11 rows
    const rows = ['timestamp,open,high,low,close,volume,symbol'];
    for (let h = 0; h < 11; h++) {
      rows.push(`2024-01-01T${String(h).padStart(2, '0')}:00:00Z,100,105,95,102,1000,BTC`);
    }
    const { marketDataReader: mdr11 } = createCSVReader(rows.join('\n'));

    const engine = createEngine({
      algorithmRegistry,
      marketDataReader: mdr11
    });

    await expect(
      engine.executeHistoricalBacktest(
        baseBacktest({ endDate: new Date('2024-01-01T11:00:00Z') }) as any,
        [{ id: 'BTC', symbol: 'BTC' } as any],
        {
          deterministicSeed: 'seed',
          dataset: {
            id: 'ds',
            storageLocation: 'datasets/test.csv',
            instrumentUniverse: ['BTC'],
            startAt: new Date('2024-01-01T00:00:00Z'),
            endAt: new Date('2024-01-01T11:00:00Z')
          } as any
        }
      )
    ).rejects.toThrow('Algorithm failed 10 consecutive times');

    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(10);
  });

  it('re-throws AlgorithmNotRegisteredException immediately', async () => {
    const rows = ['timestamp,open,high,low,close,volume,symbol', '2024-01-01T00:00:00Z,100,105,95,102,1000,BTC'].join(
      '\n'
    );
    const { marketDataReader } = createCSVReader(rows);

    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockRejectedValue(new AlgorithmNotRegisteredException('algo-1'))
    };

    const engine = createEngine({ algorithmRegistry, marketDataReader });

    await expect(
      engine.executeHistoricalBacktest(baseBacktest() as any, [{ id: 'BTC', symbol: 'BTC' } as any], {
        deterministicSeed: 'seed',
        dataset: {
          id: 'ds',
          storageLocation: 'datasets/test.csv',
          instrumentUniverse: ['BTC'],
          startAt: new Date('2024-01-01T00:00:00Z'),
          endAt: new Date('2024-01-01T01:00:00Z')
        } as any
      })
    ).rejects.toThrow(AlgorithmNotRegisteredException);

    // Should fail on first call — no retries
    expect(algorithmRegistry.executeAlgorithm).toHaveBeenCalledTimes(1);
  });

  it('executes a BUY then SELL sequence and records two trades', async () => {
    // 3 candles: BUY at T0, hold at T1, SELL at T2
    const csv = [
      'timestamp,open,high,low,close,volume,symbol',
      '2024-01-01T00:00:00Z,100,105,95,100,1000,BTC',
      '2024-01-01T01:00:00Z,100,110,95,105,1100,BTC',
      '2024-01-01T02:00:00Z,105,115,100,110,1200,BTC'
    ].join('\n');

    const { marketDataReader } = createCSVReader(csv);

    const algorithmRegistry = {
      executeAlgorithm: jest
        .fn()
        .mockResolvedValueOnce({
          success: true,
          signals: [{ type: SignalType.BUY, coinId: 'BTC', quantity: 2, confidence: 0.9, reason: 'entry' }],
          timestamp: new Date()
        })
        .mockResolvedValueOnce({ success: true, signals: [], timestamp: new Date() })
        .mockResolvedValueOnce({
          success: true,
          signals: [{ type: SignalType.SELL, coinId: 'BTC', quantity: 2, confidence: 0.8, reason: 'exit' }],
          timestamp: new Date()
        })
    };

    const engine = createEngine({
      algorithmRegistry,
      marketDataReader
    });

    const result = await engine.executeHistoricalBacktest(
      baseBacktest({
        endDate: new Date('2024-01-01T03:00:00Z'),
        configSnapshot: { parameters: {}, run: {}, slippage: { model: 'fixed', fixedBps: 0 } }
      }) as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        deterministicSeed: 'seed',
        // Disable min hold period so the SELL at T2 isn't blocked
        minHoldMs: 0,
        dataset: {
          id: 'ds',
          storageLocation: 'datasets/test.csv',
          instrumentUniverse: ['BTC'],
          startAt: new Date('2024-01-01T00:00:00Z'),
          endAt: new Date('2024-01-01T03:00:00Z')
        } as any
      } as any
    );

    expect(result.trades).toHaveLength(2);
    expect(result.simulatedFills).toHaveLength(2);
    // First trade is BUY, second is SELL
    expect(result.trades[0].type).toBe('BUY');
    expect(result.trades[1].type).toBe('SELL');
    // Final value should differ from initial capital (price moved 100→110)
    expect(result.finalMetrics.finalValue).not.toBe(1000);
  });

  it('invokes onCheckpoint callback at the configured interval', async () => {
    // Generate enough candles to trigger checkpoint (interval=2 for testing)
    const rows = ['timestamp,open,high,low,close,volume,symbol'];
    for (let h = 0; h < 5; h++) {
      rows.push(`2024-01-01T${String(h).padStart(2, '0')}:00:00Z,100,105,95,102,1000,BTC`);
    }
    const { marketDataReader } = createCSVReader(rows.join('\n'));

    const algorithmRegistry = {
      executeAlgorithm: jest.fn().mockResolvedValue({ success: true, signals: [] })
    };

    const onCheckpoint = jest.fn().mockResolvedValue(undefined);

    const engine = createEngine({ algorithmRegistry, marketDataReader });

    await engine.executeHistoricalBacktest(
      baseBacktest({ endDate: new Date('2024-01-01T05:00:00Z') }) as any,
      [{ id: 'BTC', symbol: 'BTC' } as any],
      {
        deterministicSeed: 'seed',
        checkpointInterval: 2,
        onCheckpoint,
        dataset: {
          id: 'ds',
          storageLocation: 'datasets/test.csv',
          instrumentUniverse: ['BTC'],
          startAt: new Date('2024-01-01T00:00:00Z'),
          endAt: new Date('2024-01-01T05:00:00Z')
        } as any
      }
    );

    // 5 timestamps with interval=2: checkpoints at index 1, 3 (every 2 timestamps)
    expect(onCheckpoint).toHaveBeenCalled();
    // Each checkpoint receives (state, results, totalTimestamps)
    const [state, , totalTimestamps] = onCheckpoint.mock.calls[0];
    expect(state).toHaveProperty('lastProcessedIndex');
    expect(state).toHaveProperty('portfolio');
    expect(totalTimestamps).toBe(5);
  });
});
