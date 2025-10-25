import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import * as request from 'supertest';

import { BacktestEngine } from './backtest-engine.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { backtestConfig } from './backtest.config';
import { BacktestController } from './backtest.controller';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  BacktestType,
  SimulatedOrderFill
} from './backtest.entity';
import { BacktestService } from './backtest.service';
import { MarketDataSet } from './market-data-set.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { CoinService } from '../../coin/coin.service';
import { PriceService } from '../../price/price.service';

const queueConfig = backtestConfig();

describe('BacktestController (historical integration)', () => {
  let app: INestApplication;
  const queueAddHistoricalMock = jest.fn();
  const queueAddReplayMock = jest.fn();
  const backtestSaveMock = jest.fn();
  const backtestTradeRepoMock = { find: jest.fn(), save: jest.fn() };
  const backtestSnapshotRepoMock = { find: jest.fn(), save: jest.fn() };
  const backtestSignalRepoMock = {
    createQueryBuilder: jest.fn(() => {
      const builder: any = {
        where: () => builder,
        orderBy: () => builder,
        addOrderBy: () => builder,
        take: () => builder,
        andWhere: () => builder,
        getMany: jest.fn().mockResolvedValue([])
      };
      return builder;
    }),
    save: jest.fn()
  };
  const simulatedFillRepoMock = { find: jest.fn(), save: jest.fn() };
  const marketDataSetRepoMock = { findOne: jest.fn() };
  const backtestResultServiceMock = { persistSuccess: jest.fn(), markFailed: jest.fn(), markCancelled: jest.fn() };

  const algorithmServiceMock = {
    getAlgorithmById: jest.fn()
  };

  const backtestEngineMock = {
    executeHistoricalBacktest: jest.fn()
  };

  const backtestStreamMock = {
    publishStatus: jest.fn(),
    publishLog: jest.fn(),
    publishMetric: jest.fn(),
    publishTrace: jest.fn()
  };

  const coinServiceMock = {};
  const priceServiceMock = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BacktestController],
      providers: [
        BacktestService,
        { provide: AlgorithmService, useValue: algorithmServiceMock },
        { provide: BacktestEngine, useValue: backtestEngineMock },
        { provide: CoinService, useValue: coinServiceMock },
        { provide: PriceService, useValue: priceServiceMock },
        { provide: BacktestStreamService, useValue: backtestStreamMock },
        { provide: BacktestResultService, useValue: backtestResultServiceMock },
        {
          provide: getRepositoryToken(Backtest),
          useValue: {
            save: backtestSaveMock,
            findOne: jest.fn(),
            find: jest.fn()
          }
        },
        { provide: getRepositoryToken(BacktestTrade), useValue: backtestTradeRepoMock },
        { provide: getRepositoryToken(BacktestPerformanceSnapshot), useValue: backtestSnapshotRepoMock },
        { provide: getRepositoryToken(BacktestSignal), useValue: backtestSignalRepoMock },
        { provide: getRepositoryToken(SimulatedOrderFill), useValue: simulatedFillRepoMock },
        { provide: getRepositoryToken(MarketDataSet), useValue: marketDataSetRepoMock },
        { provide: getQueueToken(queueConfig.historicalQueue), useValue: { add: queueAddHistoricalMock } },
        { provide: getQueueToken(queueConfig.replayQueue), useValue: { add: queueAddReplayMock } }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /backtests enqueues historical job and returns run metadata', async () => {
    algorithmServiceMock.getAlgorithmById.mockResolvedValue({
      id: 'algo-123',
      name: 'Momentum Strategy',
      version: 'v1.0.0'
    });

    const savedBacktest: Partial<Backtest> = {
      id: 'backtest-001',
      status: BacktestStatus.PENDING,
      name: 'Historical Test',
      type: BacktestType.HISTORICAL,
      initialCapital: 10000,
      tradingFee: 0.001,
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: new Date('2024-01-31T00:00:00.000Z'),
      configSnapshot: {
        algorithm: { id: 'algo-123', name: 'Momentum Strategy', version: 'v1.0.0', strategyId: null },
        dataset: {
          id: 'dataset-001',
          source: 'VENDOR_FEED',
          timeframe: 'MINUTE',
          startAt: new Date('2024-01-01T00:00:00.000Z'),
          endAt: new Date('2024-01-31T00:00:00.000Z')
        },
        run: {
          type: BacktestType.HISTORICAL,
          initialCapital: 10000,
          tradingFee: 0.001,
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2024-01-31T00:00:00.000Z'
        },
        parameters: { fast: 12, slow: 26 }
      },
      deterministicSeed: 'seed-123',
      warningFlags: [],
      marketDataSet: {
        id: 'dataset-001',
        label: 'BTC Minute Data',
        source: 'VENDOR_FEED',
        instrumentUniverse: ['BTCUSDT'],
        timeframe: 'MINUTE',
        startAt: new Date('2024-01-01T00:00:00.000Z'),
        endAt: new Date('2024-01-31T00:00:00.000Z'),
        integrityScore: 95,
        checksum: 'abc123',
        storageLocation: 's3://datasets/btc',
        replayCapable: false,
        metadata: {},
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-15T00:00:00.000Z')
      } as MarketDataSet
    };

    marketDataSetRepoMock.findOne.mockResolvedValue({
      id: 'dataset-001',
      label: 'BTC Minute Data',
      source: 'VENDOR_FEED',
      instrumentUniverse: ['BTCUSDT'],
      timeframe: 'MINUTE',
      startAt: new Date('2024-01-01T00:00:00.000Z'),
      endAt: new Date('2024-01-31T00:00:00.000Z'),
      integrityScore: 95,
      checksum: 'abc123',
      storageLocation: 's3://datasets/btc',
      replayCapable: false,
      metadata: {},
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-15T00:00:00.000Z')
    } as unknown as MarketDataSet);

    backtestSaveMock.mockImplementation(async (entity: Backtest) => ({
      ...entity,
      ...savedBacktest,
      createdAt: new Date('2024-05-01T00:00:00.000Z'),
      updatedAt: new Date('2024-05-01T00:00:00.000Z')
    }));

    const response = await request(app.getHttpServer())
      .post('/backtests')
      .send({
        name: 'Historical Test',
        description: 'Validate BTC strategy for Q1',
        type: BacktestType.HISTORICAL,
        algorithmId: 'algo-123',
        marketDataSetId: 'dataset-001',
        initialCapital: 10000,
        tradingFee: 0.001,
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-31T00:00:00.000Z',
        strategyParams: { fast: 12, slow: 26 },
        deterministicSeed: 'seed-123'
      })
      .expect(202);

    expect(backtestSaveMock).toHaveBeenCalledTimes(1);
    const savedEntity = backtestSaveMock.mock.calls[0][0] as Backtest;
    expect(savedEntity.strategyParams).toEqual({ fast: 12, slow: 26 });

    expect(queueAddHistoricalMock).toHaveBeenCalledWith(
      'execute-backtest',
      {
        backtestId: 'backtest-001',
        userId: 'test-user-id',
        datasetId: 'dataset-001',
        algorithmId: 'algo-123',
        deterministicSeed: 'seed-123',
        mode: BacktestType.HISTORICAL
      },
      { jobId: 'backtest-001', removeOnComplete: true }
    );

    expect(response.body).toMatchObject({
      id: 'backtest-001',
      name: 'Historical Test',
      status: BacktestStatus.PENDING,
      mode: 'historical',
      warningFlags: [],
      algorithm: expect.objectContaining({ id: 'algo-123', name: 'Momentum Strategy' }),
      marketDataSet: expect.objectContaining({ id: 'dataset-001', label: 'BTC Minute Data' }),
      configSnapshot: expect.objectContaining({
        parameters: { fast: 12, slow: 26 }
      }),
      deterministicSeed: 'seed-123'
    });
  });
});
