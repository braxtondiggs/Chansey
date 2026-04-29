import { type ObjectLiteral, type Repository } from 'typeorm';

import { OptimizationQueryService } from './optimization-query.service';

import { type StrategyConfig } from '../../strategy/entities/strategy-config.entity';
import { type OptimizationResult } from '../entities/optimization-result.entity';

type MockRepo<T extends ObjectLiteral> = jest.Mocked<Repository<T>>;

describe('OptimizationQueryService', () => {
  let service: OptimizationQueryService;
  let optimizationResultRepo: MockRepo<OptimizationResult>;
  let strategyConfigRepo: MockRepo<StrategyConfig>;

  beforeEach(() => {
    optimizationResultRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((results) => Promise.resolve(results)),
      query: jest.fn().mockResolvedValue([])
    } as unknown as MockRepo<OptimizationResult>;

    strategyConfigRepo = {
      findOne: jest.fn(),
      save: jest.fn()
    } as unknown as MockRepo<StrategyConfig>;

    service = new OptimizationQueryService(optimizationResultRepo, strategyConfigRepo);
  });

  describe('rankResults', () => {
    it('should execute SQL ranking query with correct runId', async () => {
      const rank1Result = { id: 'result-1', avgTestScore: 2.0, rank: 1 } as unknown as OptimizationResult;
      optimizationResultRepo.findOne.mockResolvedValue(rank1Result);

      const result = await service.rankResults('run-1');

      expect(optimizationResultRepo.query).toHaveBeenCalledWith(expect.stringContaining('ROW_NUMBER()'), ['run-1']);
      expect(optimizationResultRepo.query).toHaveBeenCalledWith(expect.stringContaining('"optimizationRunId" = $1'), [
        'run-1'
      ]);
      expect(optimizationResultRepo.findOne).toHaveBeenCalledWith({
        where: { optimizationRunId: 'run-1', rank: 1 }
      });
      expect(result).toBe(rank1Result);
    });

    it('should return null when no results exist', async () => {
      optimizationResultRepo.findOne.mockResolvedValue(null);

      const result = await service.rankResults('run-1');
      expect(result).toBeNull();
    });

    it('should use composite ranking formula in SQL', async () => {
      optimizationResultRepo.findOne.mockResolvedValue(null);

      await service.rankResults('run-1');

      const sqlQuery = (optimizationResultRepo.query as jest.Mock).mock.calls[0][0] as string;
      // Verify the ranking formula components
      expect(sqlQuery).toContain('"avgTestScore"');
      expect(sqlQuery).toContain('"consistencyScore"');
      expect(sqlQuery).toContain('"overfittingWindows"');
      expect(sqlQuery).toContain('GREATEST(0.5');
    });

    it('parks zero-trade rows last via CASE...NULLS LAST', async () => {
      // Rows with total_trades = 0 (empty array, all-zero array, or NULL windowResults)
      // emit NULL from the CASE so DESC NULLS LAST sorts them after every combo that
      // actually traded — even combos with negative avgTestScore. A plain `0` multiplier
      // would have ranked them above any negative-score combo under DESC.
      optimizationResultRepo.findOne.mockResolvedValue(null);

      await service.rankResults('run-1');

      const sqlQuery = (optimizationResultRepo.query as jest.Mock).mock.calls[0][0] as string;
      expect(sqlQuery).toContain('total_trades = 0');
      expect(sqlQuery).toContain('NULLS LAST');
      expect(sqlQuery).toContain('WITH totals AS');
      // The trade multiplier still references MIN_TOTAL_TRADES (= 30) as the denominator
      expect(sqlQuery).toContain('LEAST(1.0, total_trades::float / 30');
    });
  });

  describe('findStrategyConfig', () => {
    it('should return null when not found', async () => {
      strategyConfigRepo.findOne.mockResolvedValue(null);

      const result = await service.findStrategyConfig('missing');
      expect(result).toBeNull();
    });

    it('should return strategy config when found', async () => {
      const config = { id: 'strategy-1' } as StrategyConfig;
      strategyConfigRepo.findOne.mockResolvedValue(config);

      const result = await service.findStrategyConfig('strategy-1');
      expect(result).toBe(config);
      expect(strategyConfigRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'strategy-1' }
      });
    });
  });
});
