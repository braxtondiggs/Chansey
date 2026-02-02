export * from './pipeline-filters.dto';

import { PipelineProgressionRules, PipelineStageConfig } from '../interfaces';

/**
 * Internal interface for creating pipelines (no validation - internal use only)
 */
export interface CreatePipelineInput {
  name: string;
  description?: string;
  strategyConfigId: string;
  exchangeKeyId: string;
  stageConfig: PipelineStageConfig;
  progressionRules?: PipelineProgressionRules;
}
