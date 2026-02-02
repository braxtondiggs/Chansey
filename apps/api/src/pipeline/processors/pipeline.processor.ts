import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { Pipeline } from '../entities/pipeline.entity';
import { PipelineStatus } from '../interfaces';
import { PipelineJobData, PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';

@Injectable()
@Processor('pipeline')
export class PipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(PipelineProcessor.name);

  constructor(
    private readonly orchestratorService: PipelineOrchestratorService,
    @InjectRepository(Pipeline)
    private readonly pipelineRepository: Repository<Pipeline>
  ) {
    super();
  }

  async process(job: Job<PipelineJobData>): Promise<void> {
    const { pipelineId, stage } = job.data;
    const startTime = Date.now();
    this.logger.log(`Processing pipeline ${pipelineId} stage ${stage} (job ${job.id})`);

    try {
      // Get pipeline and verify state
      const pipeline = await this.pipelineRepository.findOne({
        where: { id: pipelineId }
      });

      if (!pipeline) {
        this.logger.error(`Pipeline ${pipelineId} not found`);
        return;
      }

      // Only process if pipeline is still running
      if (pipeline.status !== PipelineStatus.RUNNING) {
        this.logger.warn(`Pipeline ${pipelineId} is not running (status: ${pipeline.status}). Skipping stage ${stage}`);
        return;
      }

      // Execute the stage
      await this.orchestratorService.executeStage(pipelineId, stage);

      this.logger.log(`Pipeline ${pipelineId} stage ${stage} execution started`);
    } catch (error) {
      this.logger.error(`Pipeline ${pipelineId} stage ${stage} failed: ${error.message}`, error.stack);

      // Update pipeline status to failed
      await this.pipelineRepository.update(pipelineId, {
        status: PipelineStatus.FAILED,
        failureReason: error.message,
        completedAt: new Date()
      });

      throw error; // Let BullMQ handle retries if configured
    } finally {
      const duration = Date.now() - startTime;
      this.logger.debug(`Pipeline ${pipelineId} stage ${stage} took ${duration}ms`);
    }
  }
}
