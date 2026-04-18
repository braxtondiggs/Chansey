import { Injectable } from '@angular/core';

import { UserPipelineStatus } from '@chansey/api-interfaces';
import { STANDARD_POLICY, queryKeys, useAuthQuery } from '@chansey/shared';

/**
 * Frontend service for the user-facing pipeline status endpoint.
 * The dashboard status card reads this to show where the user's
 * automated trading sits in the validation pipeline. The query
 * refetches on window focus via STANDARD_POLICY.
 */
@Injectable({
  providedIn: 'root'
})
export class PipelineService {
  usePipelineStatus() {
    return useAuthQuery<UserPipelineStatus | null>(queryKeys.pipelines.status(), '/api/pipelines/status', {
      cachePolicy: STANDARD_POLICY
    });
  }
}
