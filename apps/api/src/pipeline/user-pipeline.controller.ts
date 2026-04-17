import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type UserPipelineStatus } from '@chansey/api-interfaces';

import { ActivePipelineStatusDto } from './dto';
import { PipelineEtaService } from './services/pipeline-eta.service';
import { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { User } from '../users/users.entity';

/**
 * User-facing pipeline status endpoint.
 *
 * Unlike the admin pipeline controller at `/admin/pipelines`, this exposes a
 * minimal summary scoped to the logged-in user — used by the dashboard
 * status card to tell a beginner where their automated trading sits in the
 * OPTIMIZE → HISTORICAL → LIVE_REPLAY → PAPER_TRADE → live deployment flow.
 */
@Controller('pipelines')
@ApiTags('Pipelines')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
export class UserPipelineController {
  constructor(
    private readonly pipelineEtaService: PipelineEtaService,
    private readonly orchestratorService: PipelineOrchestratorService
  ) {}

  @Get('status')
  @ApiOperation({ summary: "Get the authenticated user's most recent pipeline status" })
  @ApiOkResponse({ description: 'Pipeline status with ETA range, or null if the user has no active pipeline' })
  async getStatus(@GetUser() user: User): Promise<UserPipelineStatus | null> {
    return this.pipelineEtaService.getStatusForUser(user.id);
  }

  @Get('active-status')
  @ApiOperation({ summary: 'Check whether the current user has any active (PENDING/RUNNING/PAUSED) pipeline' })
  @ApiOkResponse({ description: 'Active pipeline status', type: ActivePipelineStatusDto })
  async getActiveStatus(@GetUser() user: User): Promise<ActivePipelineStatusDto> {
    return this.orchestratorService.getActivePipelineStatus(user.id);
  }
}
