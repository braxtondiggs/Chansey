import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Response } from 'express';

import { Role } from '@chansey/api-interfaces';

import { BacktestMonitoringService } from './backtest-monitoring.service';
import {
  BacktestFiltersDto,
  BacktestListQueryDto,
  BacktestOverviewDto,
  ExportFormat,
  PaginatedBacktestListDto,
  SignalAnalyticsDto,
  TradeAnalyticsDto
} from './dto';

import { Roles } from '../../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../../authentication/guard/roles.guard';
import { BacktestOrchestrationTask } from '../../tasks/backtest-orchestration.task';

/**
 * Admin controller for backtest monitoring dashboard.
 *
 * Provides analytics endpoints for monitoring backtest performance,
 * signal quality, trade profitability, and system health.
 *
 * All endpoints require admin role authorization.
 */
@ApiTags('Admin - Backtest Monitoring')
@ApiBearerAuth('token')
@Controller('admin/backtest-monitoring')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
@Roles(Role.ADMIN)
export class BacktestMonitoringController {
  constructor(
    private readonly monitoringService: BacktestMonitoringService,
    private readonly orchestrationTask: BacktestOrchestrationTask
  ) {}

  /**
   * Get overview metrics for the backtest monitoring dashboard
   */
  @Get('overview')
  @ApiOperation({
    summary: 'Get backtest monitoring overview',
    description:
      'Returns aggregated metrics including status counts, type distribution, ' +
      'average performance metrics, recent activity, and top performing algorithms.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Overview metrics retrieved successfully',
    type: BacktestOverviewDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getOverview(@Query() filters: BacktestFiltersDto): Promise<BacktestOverviewDto> {
    return this.monitoringService.getOverview(filters);
  }

  /**
   * Get paginated list of backtests
   */
  @Get('backtests')
  @ApiOperation({
    summary: 'Get paginated backtest list',
    description:
      'Returns a paginated list of backtests with filtering, sorting, and search capabilities. ' +
      'Includes algorithm and user information for each backtest.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Backtest list retrieved successfully',
    type: PaginatedBacktestListDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getBacktests(@Query() query: BacktestListQueryDto): Promise<PaginatedBacktestListDto> {
    return this.monitoringService.getBacktests(query);
  }

  /**
   * Get signal analytics
   */
  @Get('signal-analytics')
  @ApiOperation({
    summary: 'Get signal quality analytics',
    description:
      'Returns comprehensive signal analytics including overall statistics, ' +
      'metrics by confidence bucket, signal type, direction, and instrument.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signal analytics retrieved successfully',
    type: SignalAnalyticsDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getSignalAnalytics(@Query() filters: BacktestFiltersDto): Promise<SignalAnalyticsDto> {
    return this.monitoringService.getSignalAnalytics(filters);
  }

  /**
   * Get trade analytics
   */
  @Get('trade-analytics')
  @ApiOperation({
    summary: 'Get trade profitability analytics',
    description:
      'Returns comprehensive trade analytics including summary statistics, ' +
      'profitability metrics, duration statistics, slippage analysis, and per-instrument breakdown.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trade analytics retrieved successfully',
    type: TradeAnalyticsDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getTradeAnalytics(@Query() filters: BacktestFiltersDto): Promise<TradeAnalyticsDto> {
    return this.monitoringService.getTradeAnalytics(filters);
  }

  /**
   * Manually trigger backtest orchestration
   */
  @Post('trigger')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({
    summary: 'Trigger backtest orchestration',
    description: 'Manually triggers backtest orchestration for a specific user or all eligible users.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { userId: { type: 'string', format: 'uuid', description: 'Optional user ID' } }
    },
    required: false
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Orchestration jobs queued' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async triggerOrchestration(@Body() body?: { userId?: string }): Promise<{ queued: number }> {
    return this.orchestrationTask.triggerManualOrchestration(body?.userId);
  }

  /**
   * Get backtest orchestration queue stats
   */
  @Get('queue-stats')
  @ApiOperation({
    summary: 'Get orchestration queue statistics',
    description: 'Returns current queue counts for waiting, active, completed, failed, and delayed jobs.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Queue stats retrieved successfully' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getQueueStats() {
    return this.orchestrationTask.getQueueStats();
  }

  /**
   * Export backtests as CSV or JSON
   */
  @Get('export/backtests')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @ApiOperation({
    summary: 'Export backtests',
    description: 'Exports filtered backtests as CSV or JSON format for further analysis.'
  })
  @ApiQuery({
    name: 'format',
    enum: ExportFormat,
    required: false,
    description: 'Export format (csv or json)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Backtests exported successfully'
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async exportBacktests(
    @Query() filters: BacktestFiltersDto,
    @Query('format') format: ExportFormat = ExportFormat.CSV,
    @Res() res: Response
  ): Promise<void> {
    const data = await this.monitoringService.exportBacktests(filters, format);

    if (format === ExportFormat.JSON) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="backtests.json"');
      res.send(data);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="backtests.csv"');
      res.send(data);
    }
  }

  /**
   * Export signals for a specific backtest
   */
  @Get('export/signals/:backtestId')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @ApiOperation({
    summary: 'Export signals for a backtest',
    description: 'Exports all signals from a specific backtest as CSV or JSON format.'
  })
  @ApiParam({
    name: 'backtestId',
    description: 'The backtest ID to export signals from',
    type: 'string'
  })
  @ApiQuery({
    name: 'format',
    enum: ExportFormat,
    required: false,
    description: 'Export format (csv or json)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Signals exported successfully'
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async exportSignals(
    @Param('backtestId', ParseUUIDPipe) backtestId: string,
    @Query('format') format: ExportFormat = ExportFormat.CSV,
    @Res() res: Response
  ): Promise<void> {
    const data = await this.monitoringService.exportSignals(backtestId, format);

    if (format === ExportFormat.JSON) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="signals-${backtestId}.json"`);
      res.send(data);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="signals-${backtestId}.csv"`);
      res.send(data);
    }
  }

  /**
   * Export trades for a specific backtest
   */
  @Get('export/trades/:backtestId')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @ApiOperation({
    summary: 'Export trades for a backtest',
    description: 'Exports all trades from a specific backtest as CSV or JSON format.'
  })
  @ApiParam({
    name: 'backtestId',
    description: 'The backtest ID to export trades from',
    type: 'string'
  })
  @ApiQuery({
    name: 'format',
    enum: ExportFormat,
    required: false,
    description: 'Export format (csv or json)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trades exported successfully'
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async exportTrades(
    @Param('backtestId', ParseUUIDPipe) backtestId: string,
    @Query('format') format: ExportFormat = ExportFormat.CSV,
    @Res() res: Response
  ): Promise<void> {
    const data = await this.monitoringService.exportTrades(backtestId, format);

    if (format === ExportFormat.JSON) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="trades-${backtestId}.json"`);
      res.send(data);
    } else {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="trades-${backtestId}.csv"`);
      res.send(data);
    }
  }
}
