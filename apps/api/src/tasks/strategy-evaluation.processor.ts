import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { Job } from 'bullmq';

import { PromotionTask } from './promotion.task';
import { StrategyEvaluationTask } from './strategy-evaluation.task';

import { toErrorInfo } from '../shared/error.util';

type EvaluateStrategyJob = { strategyConfigId: string };
type ActivateDeploymentJob = { deploymentId: string; strategyName: string };

@Injectable()
@Processor('strategy-evaluation-queue')
export class StrategyEvaluationProcessor extends WorkerHost {
  private readonly logger = new Logger(StrategyEvaluationProcessor.name);

  constructor(
    private readonly strategyEvaluationTask: StrategyEvaluationTask,
    private readonly promotionTask: PromotionTask
  ) {
    super();
  }

  async process(job: Job<EvaluateStrategyJob | ActivateDeploymentJob>): Promise<void> {
    const startTime = Date.now();

    try {
      switch (job.name) {
        case 'evaluate-strategy': {
          const { strategyConfigId } = job.data as EvaluateStrategyJob;
          this.logger.log(`Processing strategy evaluation job ${job.id} for strategy ${strategyConfigId}`);
          await this.strategyEvaluationTask.processStrategyEvaluation(strategyConfigId);
          break;
        }

        case 'activate-deployment': {
          const { deploymentId, strategyName } = job.data as ActivateDeploymentJob;
          this.logger.log(`Processing deployment activation job ${job.id} for deployment ${deploymentId}`);
          await this.promotionTask.processDeploymentActivation(deploymentId, strategyName);
          break;
        }

        default:
          throw new Error(`Unknown job name: ${job.name}`);
      }

      const duration = Date.now() - startTime;
      this.logger.log(`Job ${job.id} (${job.name}) completed in ${duration}ms`);
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      const duration = Date.now() - startTime;
      this.logger.error(`Job ${job.id} (${job.name}) failed after ${duration}ms: ${err.message}`, err.stack);
      throw error;
    }
  }
}
