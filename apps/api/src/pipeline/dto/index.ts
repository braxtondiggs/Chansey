export * from './pipeline-filters.dto';

import { type PipelineProgressionRules, type PipelineStage, type PipelineStageConfig } from '../interfaces';

/**
 * Internal interface for creating pipelines (no validation - internal use only)
 */
export interface CreatePipelineInput {
  name: string;
  description?: string;
  strategyConfigId: string;
  stageConfig: PipelineStageConfig;
  progressionRules?: PipelineProgressionRules;
  /** Optional initial stage to start at (defaults to OPTIMIZE) */
  initialStage?: PipelineStage;
}
