import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  OptimizationProgressDto,
  OptimizationResultsQueryDto,
  OptimizationRunsQueryDto,
  OptimizationRunSummaryDto,
  StartOptimizationDto
} from './dto';
import { OptimizationResult } from './entities/optimization-result.entity';
import { OptimizationRun } from './entities/optimization-run.entity';
import { DEFAULT_OPTIMIZATION_CONFIG } from './interfaces';
import { OptimizationOrchestratorService } from './services';

import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { StrategyConfig } from '../strategy/entities/strategy-config.entity';

@Controller('strategies/:strategyId/optimize')
@ApiTags('Strategy Optimization')
@UseGuards(JwtAuthenticationGuard)
@ApiBearerAuth('token')
export class OptimizationController {
  constructor(private readonly orchestratorService: OptimizationOrchestratorService) {}

  @Post()
  @ApiOperation({ summary: 'Start parameter optimization for a strategy' })
  @ApiParam({ name: 'strategyId', description: 'Strategy configuration ID' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Optimization started', type: OptimizationRunSummaryDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Strategy not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid optimization configuration' })
  async startOptimization(
    @Param('strategyId', ParseUUIDPipe) strategyId: string,
    @Body() dto: StartOptimizationDto
  ): Promise<OptimizationRun> {
    // Merge with defaults if config not fully provided
    const config: import('./interfaces').OptimizationConfig = dto.config
      ? {
          ...DEFAULT_OPTIMIZATION_CONFIG,
          ...dto.config,
          walkForward: {
            ...DEFAULT_OPTIMIZATION_CONFIG.walkForward,
            ...dto.config.walkForward
          },
          objective: {
            ...DEFAULT_OPTIMIZATION_CONFIG.objective,
            ...dto.config.objective
          },
          earlyStop: dto.config.earlyStop
            ? {
                ...DEFAULT_OPTIMIZATION_CONFIG.earlyStop,
                ...dto.config.earlyStop
              }
            : DEFAULT_OPTIMIZATION_CONFIG.earlyStop,
          parallelism: DEFAULT_OPTIMIZATION_CONFIG.parallelism,
          dateRange: dto.config.dateRange
            ? {
                startDate: new Date(dto.config.dateRange.startDate),
                endDate: new Date(dto.config.dateRange.endDate)
              }
            : undefined
        }
      : DEFAULT_OPTIMIZATION_CONFIG;

    return this.orchestratorService.startOptimization(strategyId, dto.parameterSpace, config);
  }

  @Get()
  @ApiOperation({ summary: 'List optimization runs for a strategy' })
  @ApiParam({ name: 'strategyId', description: 'Strategy configuration ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of optimization runs', type: [OptimizationRunSummaryDto] })
  async listOptimizationRuns(
    @Param('strategyId', ParseUUIDPipe) strategyId: string,
    @Query() query: OptimizationRunsQueryDto
  ): Promise<OptimizationRun[]> {
    return this.orchestratorService.listOptimizationRuns(strategyId, query.status);
  }

  @Get(':runId')
  @ApiOperation({ summary: 'Get optimization run details' })
  @ApiParam({ name: 'strategyId', description: 'Strategy configuration ID' })
  @ApiParam({ name: 'runId', description: 'Optimization run ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Optimization run details' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Optimization run not found' })
  async getOptimizationRun(
    @Param('strategyId', ParseUUIDPipe) _strategyId: string,
    @Param('runId', ParseUUIDPipe) runId: string
  ): Promise<OptimizationRun> {
    return this.orchestratorService.getOptimizationRun(runId);
  }

  @Get(':runId/progress')
  @ApiOperation({ summary: 'Get optimization progress' })
  @ApiParam({ name: 'strategyId', description: 'Strategy configuration ID' })
  @ApiParam({ name: 'runId', description: 'Optimization run ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Optimization progress', type: OptimizationProgressDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Optimization run not found' })
  async getProgress(
    @Param('strategyId', ParseUUIDPipe) _strategyId: string,
    @Param('runId', ParseUUIDPipe) runId: string
  ): Promise<OptimizationProgressDto> {
    return this.orchestratorService.getProgress(runId);
  }

  @Get(':runId/results')
  @ApiOperation({ summary: 'Get optimization results' })
  @ApiParam({ name: 'strategyId', description: 'Strategy configuration ID' })
  @ApiParam({ name: 'runId', description: 'Optimization run ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Optimization results' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Optimization run not found' })
  async getResults(
    @Param('strategyId', ParseUUIDPipe) _strategyId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query() query: OptimizationResultsQueryDto
  ): Promise<OptimizationResult[]> {
    return this.orchestratorService.getResults(runId, query.limit, query.sortBy);
  }

  @Post(':runId/cancel')
  @ApiOperation({ summary: 'Cancel running optimization' })
  @ApiParam({ name: 'strategyId', description: 'Strategy configuration ID' })
  @ApiParam({ name: 'runId', description: 'Optimization run ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Optimization cancelled' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Optimization run not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Cannot cancel optimization in current status' })
  async cancelOptimization(
    @Param('strategyId', ParseUUIDPipe) _strategyId: string,
    @Param('runId', ParseUUIDPipe) runId: string
  ): Promise<{ message: string }> {
    await this.orchestratorService.cancelOptimization(runId);
    return { message: 'Optimization cancelled successfully' };
  }

  @Post(':runId/apply')
  @ApiOperation({ summary: 'Apply best parameters to strategy' })
  @ApiParam({ name: 'strategyId', description: 'Strategy configuration ID' })
  @ApiParam({ name: 'runId', description: 'Optimization run ID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Parameters applied successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Optimization run not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Cannot apply parameters from incomplete run' })
  async applyBestParameters(
    @Param('strategyId', ParseUUIDPipe) _strategyId: string,
    @Param('runId', ParseUUIDPipe) runId: string
  ): Promise<StrategyConfig> {
    return this.orchestratorService.applyBestParameters(runId);
  }
}
