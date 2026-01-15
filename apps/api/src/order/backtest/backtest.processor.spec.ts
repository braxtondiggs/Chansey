import { Job } from 'bullmq';

import { BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';
import { BacktestProcessor } from './backtest.processor';
import { MarketDataSet } from './market-data-set.entity';

import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';

describe('BacktestProcessor', () => {
  const createJob = (data: BacktestJobData): Job<BacktestJobData> => ({ id: 'job-1', data }) as Job<BacktestJobData>;

  const createProcessor = (
    overrides: Partial<{
      backtestRepository: any;
      marketDataSetRepository: any;
      backtestEngine: any;
      coinResolver: any;
      backtestStream: any;
      backtestResultService: any;
      metricsService: any;
    }> = {}
  ) => {
    const backtestEngine = { executeHistoricalBacktest: jest.fn() };
    const coinResolver = { resolveCoins: jest.fn() };
    const backtestStream = { publishStatus: jest.fn() };
    const backtestResultService = { persistSuccess: jest.fn(), markFailed: jest.fn() };
    const metricsService = {
      startBacktestTimer: jest.fn(),
      recordBacktestCompleted: jest.fn()
    };
    const backtestRepository = { findOne: jest.fn(), save: jest.fn() };
    const marketDataSetRepository = { findOne: jest.fn() };

    return new BacktestProcessor(
      overrides.backtestEngine ?? (backtestEngine as any),
      overrides.coinResolver ?? (coinResolver as any),
      overrides.backtestStream ?? (backtestStream as any),
      overrides.backtestResultService ?? (backtestResultService as any),
      overrides.metricsService ?? (metricsService as any),
      overrides.backtestRepository ?? (backtestRepository as any),
      overrides.marketDataSetRepository ?? (marketDataSetRepository as any)
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs a pending backtest and persists success', async () => {
    const dataset = { id: 'dataset-1', instrumentUniverse: ['BTCUSDT'] } as MarketDataSet;
    const backtest = {
      id: 'backtest-1',
      status: BacktestStatus.PENDING,
      type: BacktestType.HISTORICAL,
      marketDataSet: dataset
    } as any;

    const backtestRepository = { findOne: jest.fn().mockResolvedValue(backtest), save: jest.fn() };
    const backtestStream = { publishStatus: jest.fn() };
    const backtestResultService = {
      persistSuccess: jest.fn(),
      markFailed: jest.fn(),
      clearCheckpoint: jest.fn(),
      cleanupOrphanedResults: jest
        .fn()
        .mockResolvedValue({ deleted: { trades: 0, signals: 0, fills: 0, snapshots: 0 } })
    };
    const backtestEngine = { executeHistoricalBacktest: jest.fn().mockResolvedValue({}) };
    const coinResolver = { resolveCoins: jest.fn().mockResolvedValue({ coins: [{ id: 'BTC' }], warnings: [] }) };
    const metricsTimer = jest.fn();
    const metricsService = {
      startBacktestTimer: jest.fn().mockReturnValue(metricsTimer),
      recordBacktestCompleted: jest.fn()
    };

    const processor = createProcessor({
      backtestRepository,
      backtestStream,
      backtestResultService,
      backtestEngine,
      coinResolver,
      metricsService
    });

    const job = createJob({
      backtestId: backtest.id,
      userId: 'user-1',
      datasetId: dataset.id,
      algorithmId: 'algo-1',
      deterministicSeed: 'seed-1',
      mode: BacktestType.HISTORICAL
    });

    await processor.process(job);

    expect(backtestRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: BacktestStatus.RUNNING }));
    expect(backtestStream.publishStatus).toHaveBeenCalledWith(backtest.id, 'running', undefined, {
      mode: BacktestType.HISTORICAL,
      resuming: false,
      resumeIndex: undefined
    });
    expect(coinResolver.resolveCoins).toHaveBeenCalledWith(dataset);
    expect(backtestEngine.executeHistoricalBacktest).toHaveBeenCalledWith(
      backtest,
      [{ id: 'BTC' }],
      expect.objectContaining({
        dataset,
        deterministicSeed: 'seed-1',
        telemetryEnabled: true,
        checkpointInterval: 500,
        onCheckpoint: expect.any(Function),
        resumeFrom: undefined
      })
    );
    expect(backtestResultService.clearCheckpoint).toHaveBeenCalledWith(backtest.id);
    expect(backtestResultService.persistSuccess).toHaveBeenCalledWith(backtest, {});
    expect(metricsService.recordBacktestCompleted).toHaveBeenCalledWith('algo-1', 'success');
    expect(metricsTimer).toHaveBeenCalled();
  });

  it('marks failed when instrument universe cannot be resolved', async () => {
    const dataset = { id: 'dataset-2', instrumentUniverse: [] } as MarketDataSet;
    const backtest = {
      id: 'backtest-2',
      status: BacktestStatus.PENDING,
      type: BacktestType.HISTORICAL,
      marketDataSet: dataset
    } as any;

    const backtestRepository = { findOne: jest.fn().mockResolvedValue(backtest), save: jest.fn() };
    const backtestResultService = { persistSuccess: jest.fn(), markFailed: jest.fn() };
    const coinResolver = {
      resolveCoins: jest.fn().mockRejectedValue(new InstrumentUniverseUnresolvedException('dataset-2', [], []))
    };
    const metricsTimer = jest.fn();
    const metricsService = {
      startBacktestTimer: jest.fn().mockReturnValue(metricsTimer),
      recordBacktestCompleted: jest.fn()
    };

    const processor = createProcessor({
      backtestRepository,
      backtestResultService,
      coinResolver,
      metricsService
    });

    const job = createJob({
      backtestId: backtest.id,
      userId: 'user-2',
      datasetId: dataset.id,
      algorithmId: 'algo-2',
      deterministicSeed: 'seed-2',
      mode: BacktestType.HISTORICAL
    });

    await processor.process(job);

    expect(backtestResultService.markFailed).toHaveBeenCalledWith(
      backtest.id,
      expect.stringContaining('Cannot resolve instrument universe')
    );
    expect(backtestResultService.persistSuccess).not.toHaveBeenCalled();
    expect(metricsService.recordBacktestCompleted).toHaveBeenCalledWith('algo-2', 'failed');
    expect(metricsTimer).toHaveBeenCalled();
  });
});
