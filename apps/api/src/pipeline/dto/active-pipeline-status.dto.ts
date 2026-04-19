import { ApiProperty } from '@nestjs/swagger';

import { ActivePipelineStatus } from '@chansey/api-interfaces';

/**
 * Response DTO for the user-facing active pipeline status endpoint.
 * Used by the frontend to surface a transparency banner when a user
 * changes settings while a pipeline is in flight.
 */
export class ActivePipelineStatusDto implements ActivePipelineStatus {
  @ApiProperty({
    description: 'Whether the user has at least one pipeline in PENDING, RUNNING, or PAUSED status',
    example: true
  })
  hasActivePipeline: boolean;

  @ApiProperty({
    description: 'Number of active pipelines (PENDING, RUNNING, or PAUSED) for this user',
    example: 1
  })
  activeCount: number;
}
