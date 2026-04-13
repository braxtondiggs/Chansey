import { type Job } from 'bullmq';
import { type Repository } from 'typeorm';

import { PipelineProcessor } from './pipeline.processor';

import { type Pipeline } from '../entities/pipeline.entity';
import { PipelineStage, PipelineStatus, type PipelineJobData } from '../interfaces';
import { type PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';

describe('PipelineProcessor', () => {
  let processor: PipelineProcessor;
  let orchestratorService: jest.Mocked<PipelineOrchestratorService>;
  let failedJobService: { recordFailure: jest.Mock };
  let pipelineRepository: jest.Mocked<Repository<Pipeline>>;

  const PIPELINE_ID = 'pipeline-123';
  const STAGE = PipelineStage.OPTIMIZE;
  const RETRY_DELAY = PipelineProcessor['PENDING_RETRY_DELAY_MS'];

  const makeJob = (): Job<PipelineJobData> =>
    ({
      id: 'job-1',
      data: { pipelineId: PIPELINE_ID, stage: STAGE, userId: 'user-1' }
    }) as unknown as Job<PipelineJobData>;

  const makePipeline = (status: PipelineStatus): Pipeline =>
    ({ id: PIPELINE_ID, status, currentStage: STAGE }) as Pipeline;

  beforeEach(() => {
    orchestratorService = {
      executeStage: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<PipelineOrchestratorService>;

    failedJobService = { recordFailure: jest.fn() };

    pipelineRepository = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue(undefined)
    } as unknown as jest.Mocked<Repository<Pipeline>>;

    processor = new PipelineProcessor(orchestratorService, failedJobService as any, pipelineRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns silently and skips execution when pipeline is not found', async () => {
    pipelineRepository.findOne.mockResolvedValueOnce(null);

    await processor.process(makeJob());

    expect(orchestratorService.executeStage).not.toHaveBeenCalled();
    expect(pipelineRepository.update).not.toHaveBeenCalled();
  });

  it('executes the stage on the happy path when status is RUNNING', async () => {
    pipelineRepository.findOne.mockResolvedValueOnce(makePipeline(PipelineStatus.RUNNING));

    await processor.process(makeJob());

    expect(orchestratorService.executeStage).toHaveBeenCalledWith(PIPELINE_ID, STAGE);
    expect(pipelineRepository.update).not.toHaveBeenCalled();
  });

  it('retries on PENDING then executes when pipeline transitions to RUNNING', async () => {
    jest.useFakeTimers();
    pipelineRepository.findOne
      .mockResolvedValueOnce(makePipeline(PipelineStatus.PENDING))
      .mockResolvedValueOnce(makePipeline(PipelineStatus.RUNNING));

    const promise = processor.process(makeJob());
    await jest.advanceTimersByTimeAsync(RETRY_DELAY);
    await promise;

    expect(pipelineRepository.findOne).toHaveBeenCalledTimes(2);
    expect(orchestratorService.executeStage).toHaveBeenCalledWith(PIPELINE_ID, STAGE);
    expect(pipelineRepository.update).not.toHaveBeenCalled();
  });

  it('marks pipeline FAILED and rethrows when status is still PENDING after retry', async () => {
    jest.useFakeTimers();
    pipelineRepository.findOne
      .mockResolvedValueOnce(makePipeline(PipelineStatus.PENDING))
      .mockResolvedValueOnce(makePipeline(PipelineStatus.PENDING));

    const promise = processor.process(makeJob());
    // Attach the rejection assertion before advancing timers so the rejection
    // does not fire as an unhandled promise during timer flush.
    const assertion = expect(promise).rejects.toThrow(/still PENDING after \d+ms retry/);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY);
    await assertion;

    expect(orchestratorService.executeStage).not.toHaveBeenCalled();
    expect(pipelineRepository.update).toHaveBeenCalledWith(
      PIPELINE_ID,
      expect.objectContaining({
        status: PipelineStatus.FAILED,
        failureReason: expect.stringMatching(/still PENDING after \d+ms retry/),
        completedAt: expect.any(Date)
      })
    );
  });

  it('marks pipeline FAILED and rethrows when pipeline disappears during retry', async () => {
    jest.useFakeTimers();
    pipelineRepository.findOne.mockResolvedValueOnce(makePipeline(PipelineStatus.PENDING)).mockResolvedValueOnce(null);

    const promise = processor.process(makeJob());
    const assertion = expect(promise).rejects.toThrow(/orchestrator transaction may not have committed/);
    await jest.advanceTimersByTimeAsync(RETRY_DELAY);
    await assertion;

    expect(orchestratorService.executeStage).not.toHaveBeenCalled();
    expect(pipelineRepository.update).toHaveBeenCalledWith(
      PIPELINE_ID,
      expect.objectContaining({ status: PipelineStatus.FAILED })
    );
  });

  it.each([[PipelineStatus.CANCELLED], [PipelineStatus.COMPLETED], [PipelineStatus.PAUSED]])(
    'returns silently without marking FAILED when pipeline is in terminal state %s',
    async (status) => {
      pipelineRepository.findOne.mockResolvedValueOnce(makePipeline(status));

      await processor.process(makeJob());

      expect(orchestratorService.executeStage).not.toHaveBeenCalled();
      expect(pipelineRepository.update).not.toHaveBeenCalled();
    }
  );

  it('marks pipeline FAILED with the orchestrator error when executeStage throws', async () => {
    pipelineRepository.findOne.mockResolvedValueOnce(makePipeline(PipelineStatus.RUNNING));
    orchestratorService.executeStage.mockRejectedValueOnce(new Error('stage exploded'));

    await expect(processor.process(makeJob())).rejects.toThrow('stage exploded');

    expect(pipelineRepository.update).toHaveBeenCalledWith(
      PIPELINE_ID,
      expect.objectContaining({
        status: PipelineStatus.FAILED,
        failureReason: 'stage exploded',
        completedAt: expect.any(Date)
      })
    );
  });
});
