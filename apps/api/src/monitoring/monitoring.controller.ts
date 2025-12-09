import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

import { DriftDetectorService } from './drift-detector.service';
import { MonitoringService } from './monitoring.service';

/**
 * MonitoringController
 *
 * REST API for performance monitoring and drift detection.
 *
 * Endpoints:
 * - GET /monitoring/deployments/:id/performance - Get performance summary
 * - GET /monitoring/deployments/:id/performance/metrics - Get performance time series
 * - GET /monitoring/deployments/:id/performance/comparison - Compare to backtest
 * - GET /monitoring/deployments/:id/drift - Get drift alerts and summary
 * - GET /monitoring/deployments/:id/drift/active - Get active drift alerts only
 */
@ApiTags('Monitoring')
@Controller('monitoring/deployments')
// @UseGuards(JwtAuthGuard) // TODO: Uncomment when auth is implemented
export class MonitoringController {
  constructor(
    private readonly monitoringService: MonitoringService,
    private readonly driftDetectorService: DriftDetectorService
  ) {}

  /**
   * Get performance summary for a deployment
   */
  @Get(':id/performance')
  @ApiOperation({ summary: 'Get performance summary for a deployment' })
  @ApiResponse({ status: 200, description: 'Performance summary with key metrics' })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  async getPerformanceSummary(@Param('id') id: string): Promise<any> {
    return await this.monitoringService.getPerformanceSummary(id);
  }

  /**
   * Get performance metrics time series
   */
  @Get(':id/performance/metrics')
  @ApiOperation({ summary: 'Get performance metrics time series' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Array of daily performance metrics' })
  async getPerformanceMetrics(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ): Promise<any> {
    return await this.monitoringService.getPerformanceMetrics(id, startDate, endDate);
  }

  /**
   * Compare live performance to backtest expectations
   */
  @Get(':id/performance/comparison')
  @ApiOperation({ summary: 'Compare live performance to backtest expectations' })
  @ApiResponse({ status: 200, description: 'Comparison of live vs backtest metrics' })
  async compareToBacktest(@Param('id') id: string): Promise<any> {
    return await this.monitoringService.compareToBacktest(id);
  }

  /**
   * Get rolling statistics
   */
  @Get(':id/performance/rolling')
  @ApiOperation({ summary: 'Get rolling statistics for a deployment' })
  @ApiQuery({ name: 'windowDays', required: false, description: 'Rolling window in days (default: 30)' })
  @ApiResponse({ status: 200, description: 'Rolling statistics' })
  async getRollingStatistics(@Param('id') id: string, @Query('windowDays') windowDays?: number): Promise<any> {
    return await this.monitoringService.getRollingStatistics(id, windowDays || 30);
  }

  /**
   * Get performance trend
   */
  @Get(':id/performance/trend')
  @ApiOperation({ summary: 'Get performance trend (improving/degrading/stable)' })
  @ApiResponse({ status: 200, description: 'Performance trend indicator' })
  async getPerformanceTrend(@Param('id') id: string): Promise<{ trend: string }> {
    const trend = await this.monitoringService.getPerformanceTrend(id);
    return { trend };
  }

  /**
   * Get drift summary for a deployment
   */
  @Get(':id/drift')
  @ApiOperation({ summary: 'Get drift summary for a deployment' })
  @ApiResponse({ status: 200, description: 'Drift summary with all alerts' })
  async getDriftSummary(@Param('id') id: string): Promise<any> {
    return await this.driftDetectorService.getDriftSummary(id);
  }

  /**
   * Get active drift alerts only
   */
  @Get(':id/drift/active')
  @ApiOperation({ summary: 'Get active drift alerts for a deployment' })
  @ApiResponse({ status: 200, description: 'List of unresolved drift alerts' })
  async getActiveDriftAlerts(@Param('id') id: string): Promise<any> {
    return await this.driftDetectorService.getActiveDriftAlerts(id);
  }

  /**
   * Get all drift alerts (active and resolved)
   */
  @Get(':id/drift/all')
  @ApiOperation({ summary: 'Get all drift alerts for a deployment' })
  @ApiResponse({ status: 200, description: 'List of all drift alerts' })
  async getAllDriftAlerts(@Param('id') id: string): Promise<any> {
    return await this.driftDetectorService.getAllDriftAlerts(id);
  }
}
