import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { toErrorInfo } from '../../shared/error.util';
import { Pipeline } from '../entities/pipeline.entity';
import { PipelineJobData, PipelineStatus } from '../interfaces';
import { PipelineOrchestratorService } from '../services/pipeline-orchestrator.service';

@Injectable()
@Processor('pipeline')
export class PipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(PipelineProcessor.name);
  private static readonly PENDING_RETRY_DELAY_MS = 2000;

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
      let pipeline = await this.pipelineRepository.findOne({
        where: { id: pipelineId }
      });

      if (!pipeline) {
        this.logger.error(`Pipeline ${pipelineId} not found`);
        return;
      }

      // Defense-in-depth against PG/Redis race: if the worker picks up the job
      // before the orchestrator's transaction commits, we'll see PENDING. Wait
      // briefly and re-read before giving up.
      if (pipeline.status === PipelineStatus.PENDING) {
        this.logger.warn(
          `Pipeline ${pipelineId} is PENDING — possible race condition, retrying in ${PipelineProcessor.PENDING_RETRY_DELAY_MS}ms`
        );
        await new Promise((resolve) => setTimeout(resolve, PipelineProcessor.PENDING_RETRY_DELAY_MS));
        const retried = await this.pipelineRepository.findOne({ where: { id: pipelineId } });
        if (!retried || retried.status !== PipelineStatus.RUNNING) {
          // Throw so the catch handler marks the pipeline FAILED — silently
          // returning here would orphan the pipeline (no worker job, status
          // never advances), recreating a narrower version of the original race.
          throw new Error(
            `Pipeline ${pipelineId} still PENDING after ${PipelineProcessor.PENDING_RETRY_DELAY_MS}ms retry (status: ${retried?.status}) — orchestrator transaction may not have committed`
          );
        }
        pipeline = retried;
      } else if (pipeline.status !== PipelineStatus.RUNNING) {
        // Only process if pipeline is still running. CANCELLED/COMPLETED/PAUSED
        // are intentional terminal states — silently skipping is correct here.
        this.logger.warn(`Pipeline ${pipelineId} is not running (status: ${pipeline.status}). Skipping stage ${stage}`);
        return;
      }

      // Execute the stage
      await this.orchestratorService.executeStage(pipelineId, stage);

      this.logger.log(`Pipeline ${pipelineId} stage ${stage} execution started`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Pipeline ${pipelineId} stage ${stage} failed: ${err.message}`, err.stack);

      // Update pipeline status to failed
      await this.pipelineRepository.update(pipelineId, {
        status: PipelineStatus.FAILED,
        failureReason: err.message,
        completedAt: new Date()
      });

      throw error; // Let BullMQ handle retries if configured
    } finally {
      const duration = Date.now() - startTime;
      this.logger.debug(`Pipeline ${pipelineId} stage ${stage} took ${duration}ms`);
    }
  }
}
