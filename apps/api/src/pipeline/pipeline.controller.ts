import {
  Body,
  Controller,
  forwardRef,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Role } from '@chansey/api-interfaces';

import { PipelineFiltersDto } from './dto';
import { Pipeline } from './entities/pipeline.entity';
import { PipelineSummaryReport } from './interfaces';
import { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';
import { PipelineReportService } from './services/pipeline-report.service';

import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';
import { PipelineOrchestrationTask } from '../tasks/pipeline-orchestration.task';

/**
 * Admin controller for pipeline monitoring.
 *
 * Pipelines are created automatically by the PipelineOrchestrationTask.
 * This controller provides admin-only visibility and control for debugging/monitoring.
 */
@Controller('admin/pipelines')
@ApiTags('Admin - Pipelines')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PipelineController {
  constructor(
    private readonly orchestratorService: PipelineOrchestratorService,
    private readonly reportService: PipelineReportService,
    @Inject(forwardRef(() => PipelineOrchestrationTask))
    private readonly orchestrationTask: PipelineOrchestrationTask
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all pipelines (admin only)' })
  @ApiOkResponse({ description: 'List of pipelines' })
  @ApiForbiddenResponse({ description: 'Requires admin role' })
  async findAll(@Query() filters: PipelineFiltersDto): Promise<{ data: Pipeline[]; total: number }> {
    return this.orchestratorService.findAllAdmin(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get pipeline by ID (admin only)' })
  @ApiOkResponse({ description: 'Pipeline details', type: Pipeline })
  @ApiNotFoundResponse({ description: 'Pipeline not found' })
  @ApiForbiddenResponse({ description: 'Requires admin role' })
  async findOne(@Param('id', new ParseUUIDPipe()) id: string): Promise<Pipeline> {
    return this.orchestratorService.findOneAdmin(id);
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'Get pipeline summary report (admin only)' })
  @ApiOkResponse({ description: 'Pipeline report' })
  @ApiNotFoundResponse({ description: 'Pipeline not found' })
  @ApiForbiddenResponse({ description: 'Requires admin role' })
  async getReport(@Param('id', new ParseUUIDPipe()) id: string): Promise<PipelineSummaryReport | null> {
    return this.reportService.getReport(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel pipeline execution (admin only)' })
  @ApiOkResponse({ description: 'Pipeline cancelled', type: Pipeline })
  @ApiNotFoundResponse({ description: 'Pipeline not found' })
  @ApiForbiddenResponse({ description: 'Requires admin role' })
  async cancel(@Param('id', new ParseUUIDPipe()) id: string): Promise<Pipeline> {
    return this.orchestratorService.cancelPipelineAdmin(id);
  }

  @Post('trigger')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({
    summary: 'Trigger pipeline orchestration (admin only)',
    description: 'Manually runs pipeline orchestration for one user or every eligible user.'
  })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: { userId: { type: 'string', format: 'uuid', description: 'Optional user ID' } }
    }
  })
  @ApiOkResponse({ description: 'Orchestration jobs queued' })
  @ApiForbiddenResponse({ description: 'Requires admin role' })
  async triggerOrchestration(@Body() body?: { userId?: string }): Promise<{ queued: number }> {
    return this.orchestrationTask.triggerManualOrchestration(body?.userId);
  }
}
