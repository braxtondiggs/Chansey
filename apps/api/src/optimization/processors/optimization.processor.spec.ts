import { type ConfigService } from '@nestjs/config';

import { type Job } from 'bullmq';

import { OptimizationProcessor } from './optimization.processor';

import { type OptimizationOrchestratorService } from '../services';

describe('OptimizationProcessor', () => {
  let processor: OptimizationProcessor;
  let orchestratorService: jest.Mocked<OptimizationOrchestratorService>;
  let configService: jest.Mocked<ConfigService>;
  let mockWorker: { concurrency: number };

  beforeEach(() => {
    orchestratorService = {
      executeOptimization: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<OptimizationOrchestratorService>;

    configService = {
      get: jest.fn().mockReturnValue(3)
    } as unknown as jest.Mocked<ConfigService>;

    processor = new OptimizationProcessor(orchestratorService, configService, { recordFailure: jest.fn() } as any);

    // WorkerHost.worker is a getter — use Object.defineProperty to mock it
    mockWorker = { concurrency: 2 };
    Object.defineProperty(processor, 'worker', {
      get: () => mockWorker,
      configurable: true
    });
  });

  describe('onModuleInit', () => {
    it('should set worker concurrency from config', () => {
      configService.get.mockReturnValue(5);

      processor.onModuleInit();

      expect(configService.get).toHaveBeenCalledWith('optimization.concurrency', 3);
      expect(mockWorker.concurrency).toBe(5);
    });

    it('should use default concurrency when config is not set', () => {
      configService.get.mockReturnValue(3);

      processor.onModuleInit();

      expect(mockWorker.concurrency).toBe(3);
    });
  });

  describe('process', () => {
    it('should delegate to orchestrator service', async () => {
      const job = {
        id: 'job-1',
        data: {
          runId: 'run-1',
          combinations: [{ index: 0, values: {}, isBaseline: true }]
        },
        token: 'token-1',
        extendLock: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job;

      await processor.process(job);

      expect(orchestratorService.executeOptimization).toHaveBeenCalledWith('run-1', [
        { index: 0, values: {}, isBaseline: true }
      ]);
    });

    it('should rethrow errors from orchestrator', async () => {
      const job = {
        id: 'job-1',
        data: { runId: 'run-1', combinations: [] },
        token: 'token-1',
        extendLock: jest.fn().mockResolvedValue(undefined)
      } as unknown as Job;

      orchestratorService.executeOptimization.mockRejectedValue(new Error('Optimization failed'));

      await expect(processor.process(job)).rejects.toThrow('Optimization failed');
    });
  });
});
