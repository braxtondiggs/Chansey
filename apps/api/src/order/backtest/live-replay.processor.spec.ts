import { Job } from 'bullmq';

import { ReplaySpeed } from '@chansey/api-interfaces';

import { BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestJobData } from './backtest.job-data';
import { LiveReplayProcessor } from './live-replay.processor';
import { MarketDataSet } from './market-data-set.entity';

import { InstrumentUniverseUnresolvedException } from '../../common/exceptions';

describe('LiveReplayProcessor', () => {
  const createJob = (data: BacktestJobData): Job<BacktestJobData> => ({ id: 'job-1', data }) as Job<BacktestJobData>;

  const createProcessor = (
    overrides: Partial<{
      backtestRepository: any;
      marketDataSetRepository: any;
      backtestEngine: any;
      coinResolver: any;
      backtestStream: any;
      backtestResultService: any;
      backtestPauseService: any;
      metricsService: any;
    }> = {}
  ) => {
    const backtestEngine = { executeHistoricalBacktest: jest.fn() };
    const coinResolver = { resolveCoins: jest.fn() };
    const backtestStream = { publishStatus: jest.fn() };
    const backtestResultService = { persistSuccess: jest.fn(), markFailed: jest.fn() };
    const backtestPauseService = { clearPauseFlag: jest.fn(), isPauseRequested: jest.fn() };
    const metricsService = {
      startBacktestTimer: jest.fn(),
      recordBacktestCompleted: jest.fn()
    };
    const backtestRepository = { findOne: jest.fn(), save: jest.fn() };
    const marketDataSetRepository = { findOne: jest.fn() };

    return new LiveReplayProcessor(
      overrides.backtestEngine ?? (backtestEngine as any),
      overrides.coinResolver ?? (coinResolver as any),
      overrides.backtestStream ?? (backtestStream as any),
      overrides.backtestResultService ?? (backtestResultService as any),
      overrides.backtestPauseService ?? (backtestPauseService as any),
      overrides.metricsService ?? (metricsService as any),
      overrides.backtestRepository ?? (backtestRepository as any),
      overrides.marketDataSetRepository ?? (marketDataSetRepository as any)
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('skips backtests not configured for live replay', async () => {
    const backtest = {
      id: 'backtest-1',
      status: BacktestStatus.PENDING,
      type: BacktestType.HISTORICAL
    } as any;

    const backtestRepository = { findOne: jest.fn().mockResolvedValue(backtest), save: jest.fn() };
    const backtestEngine = { executeHistoricalBacktest: jest.fn() };
    const metricsTimer = jest.fn();
    const metricsService = {
      startBacktestTimer: jest.fn().mockReturnValue(metricsTimer),
      recordBacktestCompleted: jest.fn()
    };

    const processor = createProcessor({ backtestRepository, backtestEngine, metricsService });

    const job = createJob({
      backtestId: backtest.id,
      userId: 'user-1',
      datasetId: 'dataset-1',
      algorithmId: 'algo-1',
      deterministicSeed: 'seed-1',
      mode: BacktestType.LIVE_REPLAY
    });

    await processor.process(job);

    expect(backtestEngine.executeHistoricalBacktest).not.toHaveBeenCalled();
    expect(metricsService.recordBacktestCompleted).not.toHaveBeenCalled();
    expect(metricsTimer).toHaveBeenCalled();
  });

  it('marks failed when dataset is not replay capable', async () => {
    const backtest = {
      id: 'backtest-2',
      status: BacktestStatus.PENDING,
      type: BacktestType.LIVE_REPLAY
    } as any;
    const dataset = { id: 'dataset-2', replayCapable: false, instrumentUniverse: ['BTC'] } as MarketDataSet;

    const backtestRepository = { findOne: jest.fn().mockResolvedValue(backtest), save: jest.fn() };
    const marketDataSetRepository = { findOne: jest.fn().mockResolvedValue(dataset) };
    const backtestResultService = { persistSuccess: jest.fn(), markFailed: jest.fn() };
    const metricsTimer = jest.fn();
    const metricsService = {
      startBacktestTimer: jest.fn().mockReturnValue(metricsTimer),
      recordBacktestCompleted: jest.fn()
    };

    const processor = createProcessor({
      backtestRepository,
      marketDataSetRepository,
      backtestResultService,
      metricsService
    });

    const job = createJob({
      backtestId: backtest.id,
      userId: 'user-2',
      datasetId: dataset.id,
      algorithmId: 'algo-2',
      deterministicSeed: 'seed-2',
      mode: BacktestType.LIVE_REPLAY
    });

    await processor.process(job);

    expect(backtestResultService.markFailed).toHaveBeenCalledWith(
      backtest.id,
      'Dataset is not flagged as replay capable'
    );
    expect(metricsService.recordBacktestCompleted).toHaveBeenCalledWith('algo-2', 'failed');
    expect(metricsTimer).toHaveBeenCalled();
  });

  it('runs a replay-capable backtest and persists success', async () => {
    const dataset = { id: 'dataset-3', replayCapable: true, instrumentUniverse: ['BTCUSDT'] } as MarketDataSet;
    const backtest = {
      id: 'backtest-3',
      status: BacktestStatus.PENDING,
      type: BacktestType.LIVE_REPLAY,
      marketDataSet: dataset
    } as any;

    const backtestRepository = { findOne: jest.fn().mockResolvedValue(backtest), save: jest.fn() };
    const backtestStream = { publishStatus: jest.fn() };
    const backtestResultService = { persistSuccess: jest.fn(), markFailed: jest.fn() };
    const backtestEngine = { executeLiveReplayBacktest: jest.fn().mockResolvedValue({ paused: false }) };
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
      userId: 'user-3',
      datasetId: dataset.id,
      algorithmId: 'algo-3',
      deterministicSeed: 'seed-3',
      mode: BacktestType.LIVE_REPLAY
    });

    await processor.process(job);

    expect(backtestRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: BacktestStatus.RUNNING }));
    expect(backtestStream.publishStatus).toHaveBeenCalledWith(backtest.id, 'running', undefined, {
      mode: BacktestType.LIVE_REPLAY,
      isLiveReplay: true,
      isResuming: false,
      replaySpeed: ReplaySpeed.FAST_5X
    });
    expect(backtestEngine.executeLiveReplayBacktest).toHaveBeenCalledWith(
      backtest,
      [{ id: 'BTC' }],
      expect.objectContaining({
        dataset,
        deterministicSeed: 'seed-3',
        telemetryEnabled: true
      })
    );
    expect(backtestResultService.persistSuccess).toHaveBeenCalledWith(backtest, { paused: false });
    expect(metricsService.recordBacktestCompleted).toHaveBeenCalledWith('algo-3', 'success');
    expect(metricsTimer).toHaveBeenCalled();
  });

  it('cleans up orphaned results when resuming from checkpoint', async () => {
    const checkpointState = {
      lastProcessedIndex: 50,
      persistedCounts: { trades: 5, signals: 10, fills: 5, snapshots: 2 }
    };
    const dataset = { id: 'dataset-resume', replayCapable: true, instrumentUniverse: ['BTCUSDT'] } as MarketDataSet;
    const backtest = {
      id: 'backtest-resume',
      status: BacktestStatus.PENDING,
      type: BacktestType.LIVE_REPLAY,
      marketDataSet: dataset,
      checkpointState
    } as any;

    const backtestRepository = { findOne: jest.fn().mockResolvedValue(backtest), save: jest.fn() };
    const backtestStream = { publishStatus: jest.fn(), publishLog: jest.fn() };
    const backtestResultService = {
      persistSuccess: jest.fn(),
      markFailed: jest.fn(),
      cleanupOrphanedResults: jest
        .fn()
        .mockResolvedValue({ deleted: { trades: 1, signals: 0, fills: 0, snapshots: 0 } })
    };
    const backtestEngine = { executeLiveReplayBacktest: jest.fn().mockResolvedValue({ paused: false }) };
    const coinResolver = { resolveCoins: jest.fn().mockResolvedValue({ coins: [{ id: 'BTC' }], warnings: [] }) };
    const backtestPauseService = { clearPauseFlag: jest.fn(), isPauseRequested: jest.fn() };
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
      backtestPauseService,
      metricsService
    });

    const job = createJob({
      backtestId: backtest.id,
      userId: 'user-resume',
      datasetId: dataset.id,
      algorithmId: 'algo-resume',
      deterministicSeed: 'seed-resume',
      mode: BacktestType.LIVE_REPLAY
    });

    await processor.process(job);

    // Verify orphan cleanup was called with checkpoint counts
    expect(backtestResultService.cleanupOrphanedResults).toHaveBeenCalledWith(
      backtest.id,
      checkpointState.persistedCounts
    );

    // Verify backtest continued to run after cleanup
    expect(backtestEngine.executeLiveReplayBacktest).toHaveBeenCalled();
    expect(backtestResultService.persistSuccess).toHaveBeenCalled();
  });

  it('marks failed when instrument universe cannot be resolved', async () => {
    const dataset = { id: 'dataset-4', replayCapable: true, instrumentUniverse: [] } as MarketDataSet;
    const backtest = {
      id: 'backtest-4',
      status: BacktestStatus.PENDING,
      type: BacktestType.LIVE_REPLAY,
      marketDataSet: dataset
    } as any;

    const backtestRepository = { findOne: jest.fn().mockResolvedValue(backtest), save: jest.fn() };
    const backtestStream = { publishStatus: jest.fn() };
    const backtestResultService = { persistSuccess: jest.fn(), markFailed: jest.fn() };
    const coinResolver = {
      resolveCoins: jest.fn().mockRejectedValue(new InstrumentUniverseUnresolvedException('dataset-4', [], []))
    };
    const metricsTimer = jest.fn();
    const metricsService = {
      startBacktestTimer: jest.fn().mockReturnValue(metricsTimer),
      recordBacktestCompleted: jest.fn()
    };

    const processor = createProcessor({
      backtestRepository,
      backtestStream,
      backtestResultService,
      coinResolver,
      metricsService
    });

    const job = createJob({
      backtestId: backtest.id,
      userId: 'user-4',
      datasetId: dataset.id,
      algorithmId: 'algo-4',
      deterministicSeed: 'seed-4',
      mode: BacktestType.LIVE_REPLAY
    });

    await processor.process(job);

    expect(backtestResultService.markFailed).toHaveBeenCalledWith(
      backtest.id,
      expect.stringContaining('Cannot resolve instrument universe')
    );
    expect(backtestResultService.persistSuccess).not.toHaveBeenCalled();
    expect(metricsService.recordBacktestCompleted).toHaveBeenCalledWith('algo-4', 'failed');
    expect(metricsTimer).toHaveBeenCalled();
  });
});
