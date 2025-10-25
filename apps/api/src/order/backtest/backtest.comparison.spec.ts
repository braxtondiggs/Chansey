import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import * as request from 'supertest';

import { BacktestEngine } from './backtest-engine.service';
import { BacktestResultService } from './backtest-result.service';
import { BacktestStreamService } from './backtest-stream.service';
import { ComparisonReportController } from './backtest.controller';
import {
  Backtest,
  BacktestPerformanceSnapshot,
  BacktestSignal,
  BacktestStatus,
  BacktestTrade,
  SimulatedOrderFill
} from './backtest.entity';
import { BacktestService } from './backtest.service';
import { ComparisonReport, ComparisonReportRun } from './comparison-report.entity';
import { MarketDataSet } from './market-data-set.entity';

import { AlgorithmService } from '../../algorithm/algorithm.service';
import { CoinService } from '../../coin/coin.service';
import { PriceService } from '../../price/price.service';

const HISTORICAL_QUEUE = 'backtest-historical';
const REPLAY_QUEUE = 'backtest-replay';

describe('ComparisonReportController', () => {
  let app: INestApplication;
  const backtestRepositoryMock = { find: jest.fn() };
  const comparisonReportRepositoryMock = { save: jest.fn(), findOne: jest.fn() };
  const comparisonReportRunRepositoryMock = { save: jest.fn() };
  const backtestSnapshotRepoMock = { find: jest.fn().mockResolvedValue([]) };

  const baseBacktests = [
    {
      id: 'run-1',
      name: 'Run One',
      description: 'first',
      type: 'HISTORICAL',
      status: BacktestStatus.COMPLETED,
      initialCapital: 10000,
      totalReturn: 0.2,
      sharpeRatio: 1.5,
      maxDrawdown: 0.1,
      winRate: 0.6,
      totalTrades: 20,
      algorithm: { id: 'algo-1', name: 'Algo 1' },
      marketDataSet: { id: 'dataset-1', label: 'Dataset', timeframe: 'MINUTE' },
      user: { id: 'test-user-id', given_name: 'Test', family_name: 'User', email: 'test@example.com' }
    },
    {
      id: 'run-2',
      name: 'Run Two',
      description: 'second',
      type: 'HISTORICAL',
      status: BacktestStatus.COMPLETED,
      initialCapital: 10000,
      totalReturn: 0.3,
      sharpeRatio: 1.7,
      maxDrawdown: 0.08,
      winRate: 0.65,
      totalTrades: 18,
      algorithm: { id: 'algo-1', name: 'Algo 1' },
      marketDataSet: { id: 'dataset-1', label: 'Dataset', timeframe: 'MINUTE' },
      user: { id: 'test-user-id', given_name: 'Test', family_name: 'User', email: 'test@example.com' }
    }
  ] as unknown as Backtest[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ComparisonReportController],
      providers: [
        BacktestService,
        { provide: AlgorithmService, useValue: {} },
        { provide: BacktestEngine, useValue: {} },
        { provide: CoinService, useValue: {} },
        { provide: PriceService, useValue: {} },
        { provide: BacktestStreamService, useValue: {} },
        { provide: BacktestResultService, useValue: {} },
        { provide: getRepositoryToken(Backtest), useValue: backtestRepositoryMock },
        { provide: getRepositoryToken(BacktestTrade), useValue: {} },
        { provide: getRepositoryToken(BacktestPerformanceSnapshot), useValue: backtestSnapshotRepoMock },
        { provide: getRepositoryToken(BacktestSignal), useValue: {} },
        { provide: getRepositoryToken(SimulatedOrderFill), useValue: {} },
        { provide: getRepositoryToken(MarketDataSet), useValue: {} },
        { provide: getRepositoryToken(ComparisonReport), useValue: comparisonReportRepositoryMock },
        { provide: getRepositoryToken(ComparisonReportRun), useValue: comparisonReportRunRepositoryMock },
        { provide: getQueueToken(HISTORICAL_QUEUE), useValue: { add: jest.fn(), getJob: jest.fn() } },
        { provide: getQueueToken(REPLAY_QUEUE), useValue: { add: jest.fn(), getJob: jest.fn() } }
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
    backtestSnapshotRepoMock.find.mockResolvedValue([]);
  });

  it('creates a comparison report', async () => {
    backtestRepositoryMock.find.mockResolvedValueOnce(baseBacktests);
    comparisonReportRepositoryMock.save.mockResolvedValueOnce({
      id: 'report-1',
      name: 'Comparison',
      createdAt: new Date('2024-05-01T00:00:00Z')
    });

    const response = await request(app.getHttpServer())
      .post('/comparison-reports')
      .send({ name: 'Comparison', runIds: ['run-1', 'run-2'] })
      .expect(201);

    expect(response.body.runs).toHaveLength(2);
    expect(comparisonReportRunRepositoryMock.save).toHaveBeenCalled();
  });

  it('retrieves an existing comparison report', async () => {
    comparisonReportRepositoryMock.findOne.mockResolvedValue({
      id: 'report-existing',
      name: 'Existing',
      createdAt: new Date('2024-05-02T00:00:00Z'),
      filters: null,
      createdBy: { id: 'test-user-id', given_name: 'Test', family_name: 'User', email: 'test@example.com' },
      runs: [
        { comparisonReportId: 'report-existing', backtestId: 'run-1' },
        { comparisonReportId: 'report-existing', backtestId: 'run-2' }
      ]
    });

    backtestRepositoryMock.find.mockResolvedValueOnce(baseBacktests);

    const response = await request(app.getHttpServer()).get('/comparison-reports/report-existing').expect(200);

    expect(response.body.id).toBe('report-existing');
    expect(response.body.runs).toHaveLength(2);
  });
});
