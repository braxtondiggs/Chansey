import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags
} from '@nestjs/swagger';

import { Role } from '@chansey/api-interfaces';

import { PipelineFiltersDto } from './dto';
import { Pipeline } from './entities/pipeline.entity';
import { PipelineSummaryReport } from './interfaces';
import { PipelineOrchestratorService } from './services/pipeline-orchestrator.service';
import { PipelineReportService } from './services/pipeline-report.service';

import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';

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
    private readonly reportService: PipelineReportService
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
}
