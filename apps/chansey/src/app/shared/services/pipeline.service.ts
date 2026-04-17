import { Injectable } from '@angular/core';

import { UserPipelineStatus } from '@chansey/api-interfaces';
import { STANDARD_POLICY, queryKeys, useAuthQuery } from '@chansey/shared';

export interface ActivePipelineStatus {
  hasActivePipeline: boolean;
  activeCount: number;
}

/**
 * Frontend service for user-facing pipeline queries.
 *
 * Exposes two reads:
 * - `usePipelineStatus()` for the dashboard status card with ETA range
 *   (OPTIMIZE → HISTORICAL → LIVE_REPLAY → PAPER_TRADE).
 * - `usePipelineActiveStatus()` for the in-flight signal that tells a user
 *   their settings changes won't apply to a running pipeline.
 */
@Injectable({ providedIn: 'root' })
export class PipelineService {
  usePipelineStatus() {
    return useAuthQuery<UserPipelineStatus | null>(queryKeys.pipelines.status(), '/api/pipelines/status', {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Query whether the current user has any pipeline in PENDING, RUNNING, or PAUSED status.
   */
  usePipelineActiveStatus() {
    return useAuthQuery<ActivePipelineStatus>(queryKeys.pipelines.activeStatus(), '/api/pipelines/active-status', {
      cachePolicy: STANDARD_POLICY
    });
  }
}
