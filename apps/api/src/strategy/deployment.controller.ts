import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpStatus, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { DeploymentService } from './deployment.service';
import { Deployment } from './entities/deployment.entity';
import { PerformanceMetric } from './entities/performance-metric.entity';

/**
 * DeploymentController
 *
 * REST API for managing strategy deployments and performance tracking.
 *
 * Endpoints:
 * - GET /deployments - List all deployments (with filters)
 * - GET /deployments/active - List active deployments only
 * - GET /deployments/:id - Get deployment details
 * - POST /deployments/:id/activate - Activate pending deployment
 * - PATCH /deployments/:id/pause - Pause active deployment
 * - PATCH /deployments/:id/resume - Resume paused deployment
 * - PATCH /deployments/:id/terminate - Terminate deployment
 * - PATCH /deployments/:id/allocation - Update allocation
 * - GET /deployments/:id/performance - Get performance metrics
 * - GET /deployments/portfolio/stats - Portfolio-level statistics
 */
@ApiTags('Deployments')
@Controller('deployments')
// @UseGuards(JwtAuthGuard) // TODO: Uncomment when auth is implemented
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  /**
   * Get all active deployments
   */
  @Get('active')
  @ApiOperation({ summary: 'Get all active deployments' })
  @ApiResponse({ status: 200, description: 'List of active deployments', type: [Deployment] })
  async getActiveDeployments(): Promise<Deployment[]> {
    return await this.deploymentService.getActiveDeployments();
  }

  /**
   * Get deployment by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get deployment by ID' })
  @ApiResponse({ status: 200, description: 'Deployment details', type: Deployment })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  async getDeployment(@Param('id') id: string): Promise<Deployment> {
    return await this.deploymentService.findOne(id);
  }

  /**
   * Activate a pending deployment
   */
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate a pending deployment' })
  @ApiResponse({ status: 200, description: 'Deployment activated', type: Deployment })
  @ApiResponse({ status: 400, description: 'Invalid deployment status' })
  @ApiResponse({ status: 404, description: 'Deployment not found' })
  async activateDeployment(@Param('id') id: string, @Body('userId') userId?: string): Promise<Deployment> {
    return await this.deploymentService.activateDeployment(id, userId);
  }

  /**
   * Pause an active deployment
   */
  @Patch(':id/pause')
  @ApiOperation({ summary: 'Pause an active deployment' })
  @ApiResponse({ status: 200, description: 'Deployment paused', type: Deployment })
  @ApiResponse({ status: 400, description: 'Invalid deployment status' })
  async pauseDeployment(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Body('userId') userId?: string
  ): Promise<Deployment> {
    return await this.deploymentService.pauseDeployment(id, reason, userId);
  }

  /**
   * Resume a paused deployment
   */
  @Patch(':id/resume')
  @ApiOperation({ summary: 'Resume a paused deployment' })
  @ApiResponse({ status: 200, description: 'Deployment resumed', type: Deployment })
  @ApiResponse({ status: 400, description: 'Invalid deployment status' })
  async resumeDeployment(@Param('id') id: string, @Body('userId') userId?: string): Promise<Deployment> {
    return await this.deploymentService.resumeDeployment(id, userId);
  }

  /**
   * Terminate a deployment
   */
  @Patch(':id/terminate')
  @ApiOperation({ summary: 'Terminate a deployment' })
  @ApiResponse({ status: 200, description: 'Deployment terminated', type: Deployment })
  async terminateDeployment(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Body('userId') userId?: string
  ): Promise<Deployment> {
    return await this.deploymentService.terminateDeployment(id, reason, userId);
  }

  /**
   * Update deployment allocation
   */
  @Patch(':id/allocation')
  @ApiOperation({ summary: 'Update deployment allocation percentage' })
  @ApiResponse({ status: 200, description: 'Allocation updated', type: Deployment })
  @ApiResponse({ status: 400, description: 'Invalid allocation value' })
  async updateAllocation(
    @Param('id') id: string,
    @Body('allocationPercent') allocationPercent: number,
    @Body('reason') reason: string,
    @Body('userId') userId?: string
  ): Promise<Deployment> {
    return await this.deploymentService.updateAllocation(id, allocationPercent, reason, userId);
  }

  /**
   * Get performance metrics for a deployment
   */
  @Get(':id/performance')
  @ApiOperation({ summary: 'Get performance metrics for a deployment' })
  @ApiQuery({ name: 'startDate', required: false, description: 'Start date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'endDate', required: false, description: 'End date (YYYY-MM-DD)' })
  @ApiResponse({ status: 200, description: 'Performance metrics', type: [PerformanceMetric] })
  async getPerformanceMetrics(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string
  ): Promise<PerformanceMetric[]> {
    return await this.deploymentService.getPerformanceMetrics(id, startDate, endDate);
  }

  /**
   * Get latest performance metric for a deployment
   */
  @Get(':id/performance/latest')
  @ApiOperation({ summary: 'Get latest performance metric for a deployment' })
  @ApiResponse({ status: 200, description: 'Latest performance metric', type: PerformanceMetric })
  async getLatestPerformanceMetric(@Param('id') id: string): Promise<PerformanceMetric | null> {
    return await this.deploymentService.getLatestPerformanceMetric(id);
  }

  /**
   * Get portfolio statistics
   */
  @Get('portfolio/stats')
  @ApiOperation({ summary: 'Get portfolio-level statistics' })
  @ApiResponse({
    status: 200,
    description: 'Portfolio statistics',
    schema: {
      type: 'object',
      properties: {
        activeDeployments: { type: 'number' },
        totalAllocation: { type: 'number' },
        hasCapacity: { type: 'boolean' },
        deploymentsAtRisk: { type: 'number' }
      }
    }
  })
  async getPortfolioStats(): Promise<{
    activeDeployments: number;
    totalAllocation: number;
    hasCapacity: boolean;
    deploymentsAtRisk: number;
  }> {
    const [active, totalAllocation, hasCapacity, atRisk] = await Promise.all([
      this.deploymentService.getActiveDeployments(),
      this.deploymentService.getTotalAllocation(),
      this.deploymentService.hasPortfolioCapacity(),
      this.deploymentService.getDeploymentsAtRisk()
    ]);

    return {
      activeDeployments: active.length,
      totalAllocation,
      hasCapacity,
      deploymentsAtRisk: atRisk.length
    };
  }

  /**
   * Get deployments at risk
   */
  @Get('portfolio/at-risk')
  @ApiOperation({ summary: 'Get deployments approaching risk limits' })
  @ApiResponse({ status: 200, description: 'Deployments at risk', type: [Deployment] })
  async getDeploymentsAtRisk(): Promise<Deployment[]> {
    return await this.deploymentService.getDeploymentsAtRisk();
  }
}
