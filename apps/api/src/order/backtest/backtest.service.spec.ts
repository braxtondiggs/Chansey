import { getQueueToken } from '@nestjs/bullmq';
import { BadRequestException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Role } from '@chansey/api-interfaces';

import { BacktestCoreRepository } from './backtest-core-repository.service';
import { BacktestMapper } from './backtest-mapper.service';
import { BacktestSignal } from './backtest-signal.entity';
import { BacktestStreamService } from './backtest-stream.service';
import { BacktestTrade } from './backtest-trade.entity';
import { backtestConfig } from './backtest.config';
import { Backtest, BacktestStatus, BacktestType } from './backtest.entity';
import { BacktestService } from './backtest.service';
import { DatasetValidatorService } from './dataset-validator.service';
import { MarketDataSet } from './market-data-set.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';

describe('BacktestService', () => {
  describe('createBacktest', () => {
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
      const backtestStream = overrides.backtestStream ?? { publishStatus: jest.fn(), publishLog: jest.fn() };
      const datasetValidator = overrides.datasetValidator ?? { validateDataset: jest.fn() };
      const backtestRepository = overrides.backtestRepository ?? { save: jest.fn() };
      const marketDataSetRepository = overrides.marketDataSetRepository ?? { findOne: jest.fn() };
      const backtestSignalRepository = { count: jest.fn() };
      const backtestTradeRepository = { count: jest.fn() };
      const historicalQueue = overrides.historicalQueue ?? { add: jest.fn() };
      const replayQueue = overrides.replayQueue ?? { add: jest.fn() };
      const metricsService = overrides.metricsService;

      const coreRepository: any = {
        save: jest.fn().mockImplementation((entity) => backtestRepository.save(entity)),
        listForUser: jest.fn(),
        findByIdsForUser: jest.fn(),
        fetchWithStandardRelations: jest.fn(),
        updateById: jest.fn(),
        buildJobPayload: jest.fn().mockImplementation((backtest: any, overrides: any = {}) => ({
          backtestId: backtest.id,
          userId: overrides.userId ?? backtest.user?.id,
          datasetId: overrides.datasetId,
          algorithmId: overrides.algorithmId,
          deterministicSeed: overrides.deterministicSeed ?? backtest.deterministicSeed,
          mode: backtest.type
        })),
        getQueueForType: jest.fn().mockImplementation((type: BacktestType) => {
          return type === BacktestType.LIVE_REPLAY ? replayQueue : historicalQueue;
        })
      };

      const mapper = new BacktestMapper();

      const service = new BacktestService(
        coreRepository,
        mapper,
        algorithmService as any,
        datasetValidator as any,
        backtestStream as any,
        marketDataSetRepository as any,
        backtestSignalRepository as any,
        backtestTradeRepository as any,
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
      type: BacktestType.HISTORICAL,
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

      backtestRepository.save.mockImplementation((entity: any) => ({
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

      expect(result.warningFlags).toEqual(expect.arrayContaining(['dataset_integrity_low', 'partial overlap']));
      expect(historicalQueue.add).toHaveBeenCalledWith(
        'execute-backtest',
        expect.objectContaining({
          backtestId: 'backtest-1',
          deterministicSeed: 'seed-1',
          mode: BacktestType.HISTORICAL
        }),
        { jobId: 'backtest-1', removeOnComplete: true, removeOnFail: 50 }
      );
      expect(metricsService.recordBacktestCreated).toHaveBeenCalledWith(BacktestType.HISTORICAL, 'Algo');
    });
  });

  describe('live replay', () => {
    const queueConfig = backtestConfig();

    let service: BacktestService;
    let algorithmService: jest.Mocked<AlgorithmService>;
    let backtestRepository: { save: jest.Mock };
    let marketDataSetRepository: { findOne: jest.Mock };
    let replayQueue: { add: jest.Mock };
    let historicalQueue: { add: jest.Mock };

    const mockUser = {
      id: 'test-user-id',
      email: 'test@example.com',
      roles: [Role.USER]
    };

    beforeEach(async () => {
      backtestRepository = { save: jest.fn() };
      marketDataSetRepository = { findOne: jest.fn() };
      replayQueue = { add: jest.fn() };
      historicalQueue = { add: jest.fn() };

      const moduleRef: TestingModule = await Test.createTestingModule({
        providers: [
          BacktestService,
          BacktestCoreRepository,
          BacktestMapper,
          { provide: AlgorithmService, useValue: { getAlgorithmById: jest.fn() } },
          { provide: BacktestStreamService, useValue: { publishStatus: jest.fn(), publishLog: jest.fn() } },
          {
            provide: DatasetValidatorService,
            useValue: { validateDataset: jest.fn().mockResolvedValue({ valid: true, errors: [], warnings: [] }) }
          },
          { provide: getRepositoryToken(Backtest), useValue: backtestRepository },
          { provide: getRepositoryToken(BacktestTrade), useValue: {} },
          { provide: getRepositoryToken(BacktestSignal), useValue: {} },
          { provide: getRepositoryToken(MarketDataSet), useValue: marketDataSetRepository },
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

      backtestRepository.save.mockImplementation((entity: Backtest) =>
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
        { jobId: backtestId, removeOnComplete: true, removeOnFail: 50 }
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
});
