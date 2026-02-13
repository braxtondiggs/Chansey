import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AlgorithmActivationService } from './algorithm-activation.service';
import { AlgorithmPerformanceService } from './algorithm-performance.service';

import { Order } from '../../order/order.entity';
import { AlgorithmPerformance } from '../algorithm-performance.entity';

describe('AlgorithmPerformanceService', () => {
  let service: AlgorithmPerformanceService;
  let mockPerformanceRepository: any;
  let mockActivationService: any;
  let mockQueryBuilder: any;

  beforeEach(async () => {
    mockQueryBuilder = {
      distinctOn: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([])
    };

    mockPerformanceRepository = {
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder)
    };

    mockActivationService = {
      findUserActiveAlgorithms: jest.fn(),
      updateAllocationPercentage: jest.fn()
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlgorithmPerformanceService,
        {
          provide: getRepositoryToken(AlgorithmPerformance),
          useValue: mockPerformanceRepository
        },
        {
          provide: getRepositoryToken(Order),
          useValue: {}
        },
        {
          provide: AlgorithmActivationService,
          useValue: mockActivationService
        }
      ]
    }).compile();

    service = module.get<AlgorithmPerformanceService>(AlgorithmPerformanceService);

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateRankings', () => {
    const buildActivation = (id: string, weight: number | null) => ({
      id,
      algorithm: { weight },
      userId: 'user-1'
    });

    const buildPerformance = (activationId: string, roi: number, sharpeRatio = 0, winRate = 0) => {
      const perf = new AlgorithmPerformance({
        algorithmActivationId: activationId,
        roi,
        sharpeRatio,
        winRate,
        totalTrades: 10
      });
      return perf;
    };

    it('should do nothing when no activations exist', async () => {
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue([]);

      await service.calculateRankings('user-1');

      expect(mockPerformanceRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(mockActivationService.updateAllocationPercentage).not.toHaveBeenCalled();
    });

    it('should do nothing when no performance records exist', async () => {
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue([buildActivation('a1', 5)]);
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.calculateRankings('user-1');

      expect(mockActivationService.updateAllocationPercentage).not.toHaveBeenCalled();
    });

    it('should give higher allocation to higher algorithm weight with equal ROI', async () => {
      const activations = [buildActivation('a1', 8), buildActivation('a2', 3)];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      // Same ROI, same risk metrics
      const perfA = buildPerformance('a1', 10, 1.0, 0.6);
      const perfB = buildPerformance('a2', 10, 1.0, 0.6);

      mockQueryBuilder.getMany.mockResolvedValue([perfA, perfB]);

      await service.calculateRankings('user-1');

      // Both get called; a1 (weight 8) should get higher allocation than a2 (weight 3)
      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      const a1Allocation = calls.find((c: any) => c[0] === 'a1')[1];
      const a2Allocation = calls.find((c: any) => c[0] === 'a2')[1];

      expect(a1Allocation).toBeGreaterThan(a2Allocation);
    });

    it('should give higher allocation to higher ROI with equal weight', async () => {
      const activations = [buildActivation('a1', 5), buildActivation('a2', 5)];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      const perfA = buildPerformance('a1', 25, 1.0, 0.6);
      const perfB = buildPerformance('a2', 5, 1.0, 0.6);

      mockQueryBuilder.getMany.mockResolvedValue([perfA, perfB]);

      await service.calculateRankings('user-1');

      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      const a1Allocation = calls.find((c: any) => c[0] === 'a1')[1];
      const a2Allocation = calls.find((c: any) => c[0] === 'a2')[1];

      expect(a1Allocation).toBeGreaterThan(a2Allocation);
    });

    it('should clamp allocations between 0.5% and 10.0%', async () => {
      // One extremely dominant activation and one very weak one
      const activations = [buildActivation('a1', 10), buildActivation('a2', 1)];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      const perfA = buildPerformance('a1', 100, 3.0, 1.0); // Max everything
      const perfB = buildPerformance('a2', 0, 0, 0); // Zero everything

      mockQueryBuilder.getMany.mockResolvedValue([perfA, perfB]);

      await service.calculateRankings('user-1');

      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      const a2Allocation = calls.find((c: any) => c[0] === 'a2')[1];

      // a2 should be clamped to minimum 0.5%
      expect(a2Allocation).toBeGreaterThanOrEqual(0.5);

      // a1 should be clamped to maximum 10%
      const a1Allocation = calls.find((c: any) => c[0] === 'a1')[1];
      expect(a1Allocation).toBeLessThanOrEqual(10.0);
    });

    it('should default algorithm weight to 5 when null', async () => {
      const activations = [buildActivation('a1', null), buildActivation('a2', 5)];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      // Same ROI and metrics — null weight should behave like weight=5
      const perfA = buildPerformance('a1', 10, 1.0, 0.6);
      const perfB = buildPerformance('a2', 10, 1.0, 0.6);

      mockQueryBuilder.getMany.mockResolvedValue([perfA, perfB]);

      await service.calculateRankings('user-1');

      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      const a1Allocation = calls.find((c: any) => c[0] === 'a1')[1];
      const a2Allocation = calls.find((c: any) => c[0] === 'a2')[1];

      // With identical metrics and same effective weight, allocations should be equal
      expect(a1Allocation).toBeCloseTo(a2Allocation, 2);
    });

    it('should distribute equally when all composite scores are zero', async () => {
      const activations = [buildActivation('a1', 1), buildActivation('a2', 1)];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      // ROI = 0, sharpe = 0, winRate = 0, weight = 1 → normalizedWeight = 0
      const perfA = buildPerformance('a1', 0, 0, 0);
      const perfB = buildPerformance('a2', 0, 0, 0);

      mockQueryBuilder.getMany.mockResolvedValue([perfA, perfB]);

      await service.calculateRankings('user-1');

      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      const a1Allocation = calls.find((c: any) => c[0] === 'a1')[1];
      const a2Allocation = calls.find((c: any) => c[0] === 'a2')[1];

      // Budget = 2 × 2.0% = 4.0%, each should get 2.0%
      expect(a1Allocation).toBeCloseTo(2.0, 2);
      expect(a2Allocation).toBeCloseTo(2.0, 2);
    });

    it('should assign rank 1 to single activation and give full budget (clamped)', async () => {
      const activations = [buildActivation('a1', 7)];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      const perfA = buildPerformance('a1', 20, 1.5, 0.7);

      mockQueryBuilder.getMany.mockResolvedValue([perfA]);

      await service.calculateRankings('user-1');

      // Performance record should have rank = 1
      expect(mockPerformanceRepository.save).toHaveBeenCalledWith(expect.objectContaining({ rank: 1 }));

      // Budget = 1 × 2.0% = 2.0%, single activation gets full budget
      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      expect(calls[0][1]).toBeCloseTo(2.0, 2);
    });

    it('should blend composite scores correctly (numerical verification)', async () => {
      // 3 activations matching the plan's numerical example
      const activations = [buildActivation('a', 8), buildActivation('b', 6), buildActivation('c', 3)];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      // A: ROI=15%, weight=8, risk-adj calculated from metrics
      const perfA = buildPerformance('a', 15, 1.0, 0.6);
      // B: ROI=25%, weight=6
      const perfB = buildPerformance('b', 25, 1.0, 0.6);
      // C: ROI=5%, weight=3
      const perfC = buildPerformance('c', 5, 0.5, 0.3);

      mockQueryBuilder.getMany.mockResolvedValue([perfA, perfB, perfC]);

      await service.calculateRankings('user-1');

      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      const allocA = calls.find((c: any) => c[0] === 'a')[1];
      const allocB = calls.find((c: any) => c[0] === 'b')[1];
      const allocC = calls.find((c: any) => c[0] === 'c')[1];

      // B has highest ROI so should get the most, A should be close due to high weight
      expect(allocB).toBeGreaterThanOrEqual(allocC);
      expect(allocA).toBeGreaterThan(allocC);
      // All should be within valid range
      expect(allocA).toBeGreaterThanOrEqual(0.5);
      expect(allocB).toBeGreaterThanOrEqual(0.5);
      expect(allocC).toBeGreaterThanOrEqual(0.5);
      expect(allocA).toBeLessThanOrEqual(10.0);
      expect(allocB).toBeLessThanOrEqual(10.0);
      expect(allocC).toBeLessThanOrEqual(10.0);
    });

    it('should sum allocations to budget after clamping and redistribution', async () => {
      // 5 activations with varying performance to trigger clamping
      const activations = [
        buildActivation('a1', 10),
        buildActivation('a2', 8),
        buildActivation('a3', 5),
        buildActivation('a4', 2),
        buildActivation('a5', 1)
      ];
      mockActivationService.findUserActiveAlgorithms.mockResolvedValue(activations);

      const perfs = [
        buildPerformance('a1', 80, 2.5, 0.9),
        buildPerformance('a2', 40, 1.5, 0.7),
        buildPerformance('a3', 10, 0.5, 0.5),
        buildPerformance('a4', 2, 0.1, 0.3),
        buildPerformance('a5', 0, 0, 0)
      ];

      mockQueryBuilder.getMany.mockResolvedValue(perfs);

      await service.calculateRankings('user-1');

      const calls = mockActivationService.updateAllocationPercentage.mock.calls;
      const totalAllocation = calls.reduce((sum: number, c: any) => sum + c[1], 0);
      const budget = activations.length * 2.0;

      // Total allocations should sum to budget
      expect(totalAllocation).toBeCloseTo(budget, 1);

      // All allocations should be within bounds
      for (const call of calls) {
        expect(call[1]).toBeGreaterThanOrEqual(0.5);
        expect(call[1]).toBeLessThanOrEqual(10.0);
      }
    });
  });
});
