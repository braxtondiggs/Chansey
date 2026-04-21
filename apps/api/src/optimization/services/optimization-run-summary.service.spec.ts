import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { type ObjectLiteral, type Repository, type SelectQueryBuilder } from 'typeorm';

import { OptimizationRunSummaryService } from './optimization-run-summary.service';

import { OptimizationResult } from '../entities/optimization-result.entity';
import { OptimizationRunSummary } from '../entities/optimization-run-summary.entity';
import { OptimizationRun, OptimizationStatus } from '../entities/optimization-run.entity';

type MockRepo<T extends ObjectLiteral> = Partial<jest.Mocked<Repository<T>>>;

type RawAggregateRow = {
  resultCount: string | null;
  avgTrainScore: string | null;
  avgTestScore: string | null;
  avgDegradation: string | null;
  avgConsistency: string | null;
  overfittingCount: string | null;
};

const makeQb = (rawOne: RawAggregateRow) => {
  const qb: Partial<SelectQueryBuilder<OptimizationResult>> = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(rawOne)
  };
  return qb as SelectQueryBuilder<OptimizationResult>;
};

describe('OptimizationRunSummaryService', () => {
  let service: OptimizationRunSummaryService;
  let summaryRepo: MockRepo<OptimizationRunSummary>;
  let runRepo: MockRepo<OptimizationRun>;
  let resultRepo: MockRepo<OptimizationResult>;

  beforeEach(async () => {
    summaryRepo = { upsert: jest.fn().mockResolvedValue(undefined) };
    runRepo = { findOne: jest.fn() };
    resultRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OptimizationRunSummaryService,
        { provide: getRepositoryToken(OptimizationRunSummary), useValue: summaryRepo },
        { provide: getRepositoryToken(OptimizationRun), useValue: runRepo },
        { provide: getRepositoryToken(OptimizationResult), useValue: resultRepo }
      ]
    }).compile();

    service = module.get(OptimizationRunSummaryService);
  });

  afterEach(() => jest.clearAllMocks());

  it('skips persistence when the run does not exist', async () => {
    (runRepo.findOne as jest.Mock).mockResolvedValueOnce(null);
    await service.computeAndPersist('missing-id');
    expect(summaryRepo.upsert).not.toHaveBeenCalled();
  });

  it('persists parsed metrics, overfittingRate, and correct upsert options', async () => {
    (runRepo.findOne as jest.Mock).mockResolvedValueOnce({
      id: 'r1',
      status: OptimizationStatus.COMPLETED,
      combinationsTested: 10,
      bestScore: 1.2,
      improvement: 5.5
    });
    (resultRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      makeQb({
        resultCount: '4',
        avgTrainScore: '0.8',
        avgTestScore: '0.7',
        avgDegradation: '0.1',
        avgConsistency: '72',
        overfittingCount: '1'
      })
    );

    await service.computeAndPersist('r1');

    const [payload, options] = (summaryRepo.upsert as jest.Mock).mock.calls[0];
    expect(payload).toMatchObject({
      optimizationRunId: 'r1',
      combinationsTested: 10,
      resultCount: 4,
      overfittingCount: 1,
      bestScore: 1.2,
      improvement: 5.5
    });
    expect(payload.avgTrainScore).toBeCloseTo(0.8, 10);
    expect(payload.avgTestScore).toBeCloseTo(0.7, 10);
    expect(payload.avgDegradation).toBeCloseTo(0.1, 10);
    expect(payload.avgConsistency).toBeCloseTo(72, 10);
    expect(payload.overfittingRate).toBeCloseTo(0.25, 10);
    expect(payload.computedAt).toBeInstanceOf(Date);
    expect(options).toEqual({
      conflictPaths: ['optimizationRunId'],
      skipUpdateIfNoValuesChanged: false
    });
  });

  it('nulls averages + overfittingRate and defaults combinationsTested when there are no results', async () => {
    (runRepo.findOne as jest.Mock).mockResolvedValueOnce({
      id: 'r1',
      status: OptimizationStatus.COMPLETED,
      combinationsTested: null,
      bestScore: null,
      improvement: null
    });
    (resultRepo.createQueryBuilder as jest.Mock).mockReturnValue(
      makeQb({
        resultCount: '0',
        avgTrainScore: null,
        avgTestScore: null,
        avgDegradation: null,
        avgConsistency: null,
        overfittingCount: '0'
      })
    );

    await service.computeAndPersist('r1');

    const [payload] = (summaryRepo.upsert as jest.Mock).mock.calls[0];
    expect(payload).toMatchObject({
      optimizationRunId: 'r1',
      combinationsTested: 0,
      resultCount: 0,
      overfittingCount: 0,
      overfittingRate: null,
      bestScore: null,
      improvement: null,
      avgTrainScore: null,
      avgTestScore: null,
      avgDegradation: null,
      avgConsistency: null
    });
  });
});
