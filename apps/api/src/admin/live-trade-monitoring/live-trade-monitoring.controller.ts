import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { Response } from 'express';

import { Role } from '@chansey/api-interfaces';

import {
  AlertsDto,
  AlgorithmListQueryDto,
  ComparisonDto,
  ExportFormat,
  LiveTradeFiltersDto,
  LiveTradeOverviewDto,
  OrderListQueryDto,
  PaginatedAlgorithmListDto,
  PaginatedOrderListDto,
  PaginatedUserActivityDto,
  SlippageAnalysisDto,
  UserActivityQueryDto
} from './dto';
import { LiveTradeAlertsService } from './live-trade-alerts.service';
import { LiveTradeAlgorithmsService } from './live-trade-algorithms.service';
import { LiveTradeComparisonService } from './live-trade-comparison.service';
import { LiveTradeOrdersService } from './live-trade-orders.service';
import { LiveTradeOverviewService } from './live-trade-overview.service';
import { LiveTradeSlippageService } from './live-trade-slippage.service';
import { LiveTradeUserActivityService } from './live-trade-user-activity.service';

import { Roles } from '../../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../../authentication/guard/roles.guard';

/**
 * Admin controller for live trade monitoring dashboard.
 *
 * Provides analytics endpoints for monitoring live trading activity,
 * comparing real performance against backtest predictions, and
 * generating performance deviation alerts.
 *
 * All endpoints require admin role authorization.
 */
@ApiTags('Admin - Live Trade Monitoring')
@ApiBearerAuth('token')
@Controller('admin/live-trade-monitoring')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
@Roles(Role.ADMIN)
export class LiveTradeMonitoringController {
  constructor(
    private readonly overview: LiveTradeOverviewService,
    private readonly algorithms: LiveTradeAlgorithmsService,
    private readonly orders: LiveTradeOrdersService,
    private readonly comparison: LiveTradeComparisonService,
    private readonly slippage: LiveTradeSlippageService,
    private readonly userActivity: LiveTradeUserActivityService,
    private readonly alerts: LiveTradeAlertsService
  ) {}

  /**
   * Get overview metrics for the live trade monitoring dashboard
   */
  @Get('overview')
  @ApiOperation({
    summary: 'Get live trade monitoring overview',
    description:
      'Returns aggregated metrics including active algorithms count, ' +
      'total orders, volume, P&L, top performing algorithms, and alerts summary.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Overview metrics retrieved successfully',
    type: LiveTradeOverviewDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getOverview(@Query() filters: LiveTradeFiltersDto): Promise<LiveTradeOverviewDto> {
    return this.overview.getOverview(filters);
  }

  /**
   * Get paginated list of active algorithm activations
   */
  @Get('algorithms')
  @ApiOperation({
    summary: 'Get active algorithm activations',
    description:
      'Returns a paginated list of algorithm activations with performance metrics, ' +
      'filtering, and sorting capabilities.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm activations retrieved successfully',
    type: PaginatedAlgorithmListDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getAlgorithms(@Query() query: AlgorithmListQueryDto): Promise<PaginatedAlgorithmListDto> {
    return this.algorithms.getAlgorithms(query);
  }

  /**
   * Get paginated list of algorithmic orders
   */
  @Get('orders')
  @ApiOperation({
    summary: 'Get algorithmic orders',
    description:
      'Returns a paginated list of orders placed by algorithms, ' + 'including slippage data and performance metrics.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithmic orders retrieved successfully',
    type: PaginatedOrderListDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getOrders(@Query() query: OrderListQueryDto): Promise<PaginatedOrderListDto> {
    return this.orders.getOrders(query);
  }

  /**
   * Get backtest vs live comparison for a specific algorithm
   */
  @Get('comparison/:algorithmId')
  @ApiOperation({
    summary: 'Get backtest vs live comparison',
    description:
      'Compares live trading performance against the most recent completed backtest ' +
      'for a specific algorithm. Returns deviation metrics and alerts.'
  })
  @ApiParam({
    name: 'algorithmId',
    description: 'The algorithm ID to compare',
    type: 'string'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Comparison data retrieved successfully',
    type: ComparisonDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Algorithm not found' })
  async getComparison(@Param('algorithmId', ParseUUIDPipe) algorithmId: string): Promise<ComparisonDto> {
    return this.comparison.getComparison(algorithmId);
  }

  /**
   * Get slippage analysis
   */
  @Get('slippage-analysis')
  @ApiOperation({
    summary: 'Get slippage analysis',
    description:
      'Returns comprehensive slippage analysis comparing live trading ' +
      'against backtest predictions, broken down by algorithm, time, and order size.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Slippage analysis retrieved successfully',
    type: SlippageAnalysisDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getSlippageAnalysis(@Query() filters: LiveTradeFiltersDto): Promise<SlippageAnalysisDto> {
    return this.slippage.getSlippageAnalysis(filters);
  }

  /**
   * Get users with active algorithms
   */
  @Get('user-activity')
  @ApiOperation({
    summary: 'Get user activity',
    description: 'Returns a paginated list of users with active algorithm activations and their trading activity.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User activity retrieved successfully',
    type: PaginatedUserActivityDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getUserActivity(@Query() query: UserActivityQueryDto): Promise<PaginatedUserActivityDto> {
    return this.userActivity.getUserActivity(query);
  }

  /**
   * Get performance deviation alerts
   */
  @Get('alerts')
  @ApiOperation({
    summary: 'Get performance alerts',
    description:
      'Returns alerts for algorithms where live performance deviates ' +
      'significantly from backtest predictions. Includes severity levels.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Alerts retrieved successfully',
    type: AlertsDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getAlerts(@Query() filters: LiveTradeFiltersDto): Promise<AlertsDto> {
    return this.alerts.getAlerts(filters);
  }

  /**
   * Export algorithmic orders as CSV or JSON
   */
  @Get('export/orders')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 requests per minute
  @ApiOperation({
    summary: 'Export algorithmic orders',
    description: 'Exports filtered algorithmic orders as CSV or JSON format for further analysis.'
  })
  @ApiQuery({
    name: 'format',
    enum: ExportFormat,
    required: false,
    description: 'Export format (csv or json)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Orders exported successfully'
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async exportOrders(
    @Query() query: OrderListQueryDto,
    @Query('format') format: ExportFormat = ExportFormat.CSV,
    @Res() res: Response
  ): Promise<void> {
    const { contentType, filename, body } = await this.orders.exportOrders(query, format);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }
}
