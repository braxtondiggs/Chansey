import { getQueueToken } from '@nestjs/bullmq';
import { ExecutionContext } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
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
import { ComparisonReport, ComparisonReportRun } from './comparison-report.entity';
import { MarketDataSet } from './market-data-set.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { JwtAuthenticationGuard } from '../../authentication/guard/jwt-authentication.guard';
import { CoinService } from '../../coin/coin.service';
import { PriceService } from '../../price/price.service';
import { User } from '../../users/users.entity';

const mockUser: Partial<User> = {
  id: 'test-user-id',
  email: 'test@example.com',
  roles: ['user']
};

const queueConfig = backtestConfig();

describe('BacktestController (live replay integration)', () => {
  let app: NestFastifyApplication;
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
  const comparisonReportRepoMock = { find: jest.fn(), save: jest.fn() };
  const comparisonReportRunRepoMock = { find: jest.fn(), save: jest.fn() };
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
        { provide: getRepositoryToken(ComparisonReport), useValue: comparisonReportRepoMock },
        { provide: getRepositoryToken(ComparisonReportRun), useValue: comparisonReportRunRepoMock },
        { provide: getQueueToken(queueConfig.historicalQueue), useValue: { add: queueAddHistoricalMock } },
        { provide: getQueueToken(queueConfig.replayQueue), useValue: { add: queueAddReplayMock } }
      ]
    })
      .overrideGuard(JwtAuthenticationGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const request = context.switchToHttp().getRequest();
          request.user = mockUser;
          return true;
        }
      })
      .compile();

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /backtests enqueues live replay job', async () => {
    const algorithmId = '550e8400-e29b-41d4-a716-446655440001';
    const datasetId = '550e8400-e29b-41d4-a716-446655440002';
    const backtestId = '550e8400-e29b-41d4-a716-446655440003';

    algorithmServiceMock.getAlgorithmById.mockResolvedValue({
      id: algorithmId,
      name: 'Live Strategy',
      version: 'v2.0.0'
    });

    const savedBacktest: Partial<Backtest> = {
      id: backtestId,
      status: BacktestStatus.PENDING,
      name: 'Live Replay Test',
      type: BacktestType.LIVE_REPLAY,
      initialCapital: 5000,
      tradingFee: 0.0005,
      startDate: new Date('2024-04-01T00:00:00.000Z'),
      endDate: new Date('2024-04-02T00:00:00.000Z'),
      marketDataSet: {
        id: datasetId,
        label: 'BTC Live Replay',
        source: 'INTERNAL_CAPTURE',
        instrumentUniverse: ['BTCUSDT'],
        timeframe: 'SECOND',
        startAt: new Date('2024-04-01T00:00:00.000Z'),
        endAt: new Date('2024-04-02T00:00:00.000Z'),
        integrityScore: 100,
        checksum: 'checksum-live',
        storageLocation: 's3://datasets/live',
        replayCapable: true,
        metadata: {},
        createdAt: new Date('2024-04-01T00:00:00.000Z'),
        updatedAt: new Date('2024-04-02T00:00:00.000Z')
      } as MarketDataSet,
      deterministicSeed: 'live-seed-1',
      warningFlags: []
    };

    marketDataSetRepoMock.findOne.mockResolvedValue({
      id: datasetId,
      label: 'BTC Live Replay',
      source: 'INTERNAL_CAPTURE',
      timeframe: 'SECOND',
      instrumentUniverse: ['BTCUSDT'],
      startAt: new Date('2024-04-01T00:00:00.000Z'),
      endAt: new Date('2024-04-02T00:00:00.000Z'),
      integrityScore: 100,
      checksum: 'checksum-live',
      storageLocation: 's3://datasets/live',
      replayCapable: true,
      metadata: {},
      createdAt: new Date('2024-04-01T00:00:00.000Z'),
      updatedAt: new Date('2024-04-02T00:00:00.000Z')
    } as MarketDataSet);

    backtestSaveMock.mockImplementation(async (entity: Backtest) => ({
      ...entity,
      ...savedBacktest,
      createdAt: new Date('2024-04-03T00:00:00.000Z'),
      updatedAt: new Date('2024-04-03T00:00:00.000Z')
    }));

    const response = await request(app.getHttpServer())
      .post('/backtests')
      .send({
        name: 'Live Replay Test',
        description: 'Replay yesterday order flow',
        type: BacktestType.LIVE_REPLAY,
        algorithmId: algorithmId,
        marketDataSetId: datasetId,
        initialCapital: 5000,
        tradingFee: 0.0005,
        startDate: '2024-04-01T00:00:00.000Z',
        endDate: '2024-04-02T00:00:00.000Z'
      })
      .expect(202);

    expect(algorithmServiceMock.getAlgorithmById).toHaveBeenCalledWith(algorithmId);
    expect(marketDataSetRepoMock.findOne).toHaveBeenCalledWith({ where: { id: datasetId } });
    expect(backtestSaveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Live Replay Test',
        description: 'Replay yesterday order flow',
        type: BacktestType.LIVE_REPLAY,
        status: BacktestStatus.PENDING,
        initialCapital: 5000,
        tradingFee: 0.0005,
        startDate: new Date('2024-04-01T00:00:00.000Z'),
        endDate: new Date('2024-04-02T00:00:00.000Z')
      })
    );

    expect(queueAddReplayMock).toHaveBeenCalledWith(
      'execute-backtest',
      expect.objectContaining({
        backtestId: backtestId,
        userId: mockUser.id,
        datasetId: datasetId,
        mode: BacktestType.LIVE_REPLAY
      }),
      { jobId: backtestId, removeOnComplete: true }
    );
    expect(queueAddReplayMock).toHaveBeenCalledTimes(1);
    expect(queueAddHistoricalMock).not.toHaveBeenCalled();

    expect(response.body).toMatchObject({
      id: backtestId,
      mode: 'live_replay',
      status: BacktestStatus.PENDING
    });
  });
});
