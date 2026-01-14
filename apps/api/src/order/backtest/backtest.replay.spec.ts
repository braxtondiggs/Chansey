import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { BacktestEngine } from './backtest-engine.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { backtestConfig } from './backtest.config';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestTrade,
  BacktestType,
  SimulatedOrderFill
} from './backtest.entity';
import { BacktestService } from './backtest.service';
import { ComparisonReport, ComparisonReportRun } from './comparison-report.entity';
import { MarketDataSet } from './market-data-set.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { CoinService } from '../../coin/coin.service';
import { OHLCService } from '../../ohlc/ohlc.service';

const queueConfig = backtestConfig();

describe('BacktestService (live replay)', () => {
  let service: BacktestService;
  let algorithmService: jest.Mocked<AlgorithmService>;
  let backtestRepository: { save: jest.Mock };
  let marketDataSetRepository: { findOne: jest.Mock };
  let replayQueue: { add: jest.Mock };
  let historicalQueue: { add: jest.Mock };

  const mockUser = {
    id: 'test-user-id',
    email: 'test@example.com',
    roles: ['user']
  };

  beforeEach(async () => {
    backtestRepository = { save: jest.fn() };
    marketDataSetRepository = { findOne: jest.fn() };
    replayQueue = { add: jest.fn() };
    historicalQueue = { add: jest.fn() };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        BacktestService,
        { provide: AlgorithmService, useValue: { getAlgorithmById: jest.fn() } },
        { provide: CoinService, useValue: {} },
        {
          provide: OHLCService,
          useValue: {
            getCoinsWithCandleData: jest.fn().mockResolvedValue([]),
            getCandleDataDateRange: jest.fn().mockResolvedValue(null),
            getCandleCount: jest.fn().mockResolvedValue(0)
          }
        },
        { provide: BacktestEngine, useValue: {} },
        { provide: BacktestStreamService, useValue: { publishStatus: jest.fn(), publishLog: jest.fn() } },
        { provide: BacktestResultService, useValue: {} },
        { provide: getRepositoryToken(Backtest), useValue: backtestRepository },
        { provide: getRepositoryToken(BacktestTrade), useValue: {} },
        { provide: getRepositoryToken(BacktestPerformanceSnapshot), useValue: {} },
        { provide: getRepositoryToken(BacktestSignal), useValue: {} },
        { provide: getRepositoryToken(SimulatedOrderFill), useValue: {} },
        { provide: getRepositoryToken(MarketDataSet), useValue: marketDataSetRepository },
        { provide: getRepositoryToken(ComparisonReport), useValue: {} },
        { provide: getRepositoryToken(ComparisonReportRun), useValue: {} },
        { provide: getQueueToken(queueConfig.historicalQueue), useValue: historicalQueue },
        { provide: getQueueToken(queueConfig.replayQueue), useValue: replayQueue }
      ]
    }).compile();

    service = moduleRef.get(BacktestService);
    algorithmService = moduleRef.get(AlgorithmService) as jest.Mocked<AlgorithmService>;
  });

  it('creates a live replay backtest and enqueues the replay job', async () => {
    const algorithmId = '550e8400-e29b-41d4-a716-446655440001';
    const datasetId = '550e8400-e29b-41d4-a716-446655440002';
    const backtestId = '550e8400-e29b-41d4-a716-446655440003';

    algorithmService.getAlgorithmById.mockResolvedValue({
      id: algorithmId,
      name: 'Live Strategy'
    } as any);

    marketDataSetRepository.findOne.mockResolvedValue({
      id: datasetId,
      label: 'BTC Live Replay',
      source: 'INTERNAL_CAPTURE',
      timeframe: 'SECOND',
      instrumentUniverse: ['BTCUSDT'],
      startAt: new Date('2024-04-01T00:00:00.000Z'),
      endAt: new Date('2024-04-02T00:00:00.000Z'),
      integrityScore: 70,
      checksum: 'checksum-live',
      storageLocation: 's3://datasets/live',
      replayCapable: true,
      metadata: {},
      createdAt: new Date('2024-04-01T00:00:00.000Z'),
      updatedAt: new Date('2024-04-02T00:00:00.000Z')
    } as MarketDataSet);

    backtestRepository.save.mockImplementation(async (entity: Backtest) =>
      Object.assign(entity, {
        id: backtestId,
        createdAt: new Date('2024-04-03T00:00:00.000Z'),
        updatedAt: new Date('2024-04-03T00:00:00.000Z')
      })
    );

    const result = await service.createBacktest(mockUser as any, {
      name: 'Live Replay Test',
      description: 'Replay yesterday order flow',
      type: BacktestType.LIVE_REPLAY,
      algorithmId,
      marketDataSetId: datasetId,
      initialCapital: 5000,
      tradingFee: 0.0005,
      startDate: '2024-04-01T00:00:00.000Z',
      endDate: '2024-04-02T00:00:00.000Z',
      deterministicSeed: 'live-seed-1'
    });

    expect(result).toMatchObject({
      id: backtestId,
      mode: 'live_replay',
      warningFlags: ['dataset_integrity_low']
    });
    expect(replayQueue.add).toHaveBeenCalledWith(
      'execute-backtest',
      expect.objectContaining({
        backtestId,
        userId: mockUser.id,
        datasetId,
        algorithmId,
        deterministicSeed: 'live-seed-1',
        mode: BacktestType.LIVE_REPLAY
      }),
      { jobId: backtestId, removeOnComplete: true }
    );
    expect(historicalQueue.add).not.toHaveBeenCalled();
  });

  it('rejects live replay for datasets without replay support', async () => {
    algorithmService.getAlgorithmById.mockResolvedValue({
      id: 'algo-id',
      name: 'Live Strategy'
    } as any);

    marketDataSetRepository.findOne.mockResolvedValue({
      id: 'dataset-id',
      replayCapable: false,
      integrityScore: 100
    } as MarketDataSet);

    await expect(
      service.createBacktest(mockUser as any, {
        name: 'Live Replay Test',
        type: BacktestType.LIVE_REPLAY,
        algorithmId: 'algo-id',
        marketDataSetId: 'dataset-id',
        initialCapital: 5000,
        startDate: '2024-04-01T00:00:00.000Z',
        endDate: '2024-04-02T00:00:00.000Z'
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(backtestRepository.save).not.toHaveBeenCalled();
    expect(replayQueue.add).not.toHaveBeenCalled();
  });
});
