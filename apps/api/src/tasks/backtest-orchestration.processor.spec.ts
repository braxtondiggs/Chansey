import { Job } from 'bullmq';

import { BacktestOrchestrationProcessor } from './backtest-orchestration.processor';
import { OrchestrationJobData, OrchestrationResult } from './dto/backtest-orchestration.dto';

describe('BacktestOrchestrationProcessor', () => {
  const mockService = {
    orchestrateForUser: jest.fn()
  };

  const createJob = (data: OrchestrationJobData): Job<OrchestrationJobData> =>
    ({ id: 'job-1', data }) as Job<OrchestrationJobData>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should orchestrate and return results for a job', async () => {
    const processor = new BacktestOrchestrationProcessor(mockService as any);
    const result: OrchestrationResult = {
      userId: 'user-1',
      backtestsCreated: 2,
      backtestIds: ['bt-1', 'bt-2'],
      skippedAlgorithms: [],
      errors: []
    };
    mockService.orchestrateForUser.mockResolvedValue(result);

    const job = createJob({
      userId: 'user-1',
      scheduledAt: new Date().toISOString(),
      riskLevel: 3
    });

    const response = await processor.process(job);

    expect(mockService.orchestrateForUser).toHaveBeenCalledWith('user-1');
    expect(response).toBe(result);
  });

  it('should rethrow errors from orchestration', async () => {
    const processor = new BacktestOrchestrationProcessor(mockService as any);
    mockService.orchestrateForUser.mockRejectedValue(new Error('Boom'));

    const job = createJob({
      userId: 'user-2',
      scheduledAt: new Date().toISOString(),
      riskLevel: 4
    });

    await expect(processor.process(job)).rejects.toThrow('Boom');
  });
});
