import { BadRequestException } from '@nestjs/common';

import { BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestService } from './backtest.service';

describe('BacktestService.createBacktest', () => {
  const createService = (
    overrides: Partial<{
      datasetValidator: any;
      backtestRepository: any;
      marketDataSetRepository: any;
      algorithmService: any;
      backtestStream: any;
      historicalQueue: any;
      replayQueue: any;
      metricsService: any;
    }> = {}
  ) => {
    const algorithmService = overrides.algorithmService ?? { getAlgorithmById: jest.fn() };
    const coinService = {};
    const ohlcService = {};
    const backtestEngine = {};
    const backtestStream = overrides.backtestStream ?? { publishStatus: jest.fn(), publishLog: jest.fn() };
    const backtestResultService = {};
    const datasetValidator = overrides.datasetValidator ?? { validateDataset: jest.fn() };
    const backtestRepository = overrides.backtestRepository ?? { save: jest.fn() };
    const backtestTradeRepository = {};
    const backtestSnapshotRepository = {};
    const marketDataSetRepository = overrides.marketDataSetRepository ?? { findOne: jest.fn() };
    const backtestSignalRepository = {};
    const simulatedFillRepository = {};
    const comparisonReportRepository = {};
    const comparisonReportRunRepository = {};
    const historicalQueue = overrides.historicalQueue ?? { add: jest.fn() };
    const replayQueue = overrides.replayQueue ?? { add: jest.fn() };
    const backtestPauseService = {};
    const metricsService = overrides.metricsService;

    const service = new BacktestService(
      algorithmService as any,
      coinService as any,
      ohlcService as any,
      backtestEngine as any,
      backtestStream as any,
      backtestResultService as any,
      datasetValidator as any,
      backtestRepository as any,
      backtestTradeRepository as any,
      backtestSnapshotRepository as any,
      marketDataSetRepository as any,
      backtestSignalRepository as any,
      simulatedFillRepository as any,
      comparisonReportRepository as any,
      comparisonReportRunRepository as any,
      historicalQueue as any,
      replayQueue as any,
      backtestPauseService as any,
      metricsService as any
    );

    return {
      service,
      algorithmService,
      datasetValidator,
      backtestRepository,
      marketDataSetRepository,
      backtestStream,
      historicalQueue,
      replayQueue,
      metricsService
    };
  };

  const baseDto = {
    name: 'Test Backtest',
    description: 'test',
    type: BacktestType.PAPER_TRADING,
    algorithmId: 'algo-1',
    marketDataSetId: 'dataset-1',
    initialCapital: 1000,
    tradingFee: 0.001,
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2024-01-02T00:00:00.000Z'
  };

  const baseDataset = {
    id: 'dataset-1',
    label: 'Dataset',
    source: 'LOCAL',
    timeframe: 'HOUR',
    startAt: new Date('2024-01-01T00:00:00.000Z'),
    endAt: new Date('2024-01-02T00:00:00.000Z'),
    integrityScore: 70,
    replayCapable: false
  };

  it('throws when dataset validation fails', async () => {
    const { service, algorithmService, datasetValidator, backtestRepository, historicalQueue } = createService();

    algorithmService.getAlgorithmById.mockResolvedValue({ id: 'algo-1', name: 'Algo' });
    datasetValidator.validateDataset.mockResolvedValue({
      valid: false,
      errors: [{ message: 'Bad dataset' }],
      warnings: []
    });

    (service as any).marketDataSetRepository.findOne = jest.fn().mockResolvedValue(baseDataset);

    await expect(service.createBacktest({ id: 'user-1' } as any, baseDto as any)).rejects.toBeInstanceOf(
      BadRequestException
    );

    expect(backtestRepository.save).not.toHaveBeenCalled();
    expect(historicalQueue.add).not.toHaveBeenCalled();
  });

  it('adds warning flags and enqueues job for non-replay dataset', async () => {
    const metricsService = { recordBacktestCreated: jest.fn() };
    const {
      service,
      algorithmService,
      datasetValidator,
      backtestRepository,
      marketDataSetRepository,
      historicalQueue
    } = createService({ metricsService });

    algorithmService.getAlgorithmById.mockResolvedValue({ id: 'algo-1', name: 'Algo' });
    marketDataSetRepository.findOne.mockResolvedValue(baseDataset);
    datasetValidator.validateDataset.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: ['partial overlap']
    });

    backtestRepository.save.mockImplementation(async (entity: any) => ({
      ...entity,
      id: 'backtest-1',
      status: BacktestStatus.PENDING,
      createdAt: new Date('2024-01-03T00:00:00.000Z'),
      updatedAt: new Date('2024-01-03T00:00:00.000Z')
    }));

    const result = await service.createBacktest(
      { id: 'user-1' } as any,
      {
        ...baseDto,
        deterministicSeed: 'seed-1'
      } as any
    );

    expect(result.warningFlags).toEqual(
      expect.arrayContaining(['dataset_integrity_low', 'dataset_not_replay_capable', 'partial overlap'])
    );
    expect(historicalQueue.add).toHaveBeenCalledWith(
      'execute-backtest',
      expect.objectContaining({
        backtestId: 'backtest-1',
        deterministicSeed: 'seed-1',
        mode: BacktestType.PAPER_TRADING
      }),
      { jobId: 'backtest-1', removeOnComplete: true }
    );
    expect(metricsService.recordBacktestCreated).toHaveBeenCalledWith(BacktestType.PAPER_TRADING, 'Algo');
  });
});
