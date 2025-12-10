import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { OptimizationOrchestratorService } from '../services';

interface OptimizationJobData {
  runId: string;
  combinations: Array<{
    index: number;
    values: Record<string, unknown>;
    isBaseline: boolean;
  }>;
}

/**
 * BullMQ processor for optimization jobs
 */
@Processor('optimization')
export class OptimizationProcessor extends WorkerHost {
  private readonly logger = new Logger(OptimizationProcessor.name);

  constructor(private readonly orchestratorService: OptimizationOrchestratorService) {
    super();
  }

  async process(job: Job<OptimizationJobData>): Promise<void> {
    const { runId, combinations } = job.data;

    this.logger.log(`Starting optimization job ${job.id} for run ${runId} with ${combinations.length} combinations`);

    try {
      await this.orchestratorService.executeOptimization(runId, combinations);
      this.logger.log(`Optimization job ${job.id} completed successfully`);
    } catch (error) {
      this.logger.error(`Optimization job ${job.id} failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
