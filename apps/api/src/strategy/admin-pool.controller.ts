import { Controller, Get, HttpStatus, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Role } from '@chansey/api-interfaces';

import { PoolStatisticsService } from './pool-statistics.service';
import { RiskPoolMappingService } from './risk-pool-mapping.service';

import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';
import { toErrorInfo } from '../shared/error.util';
import { StrategyEvaluationTask } from '../tasks/strategy-evaluation.task';

/**
 * Admin-only endpoints for monitoring and managing risk-based strategy assignment.
 * Provides visibility into risk level distribution, user allocation, and strategy assignment.
 */
@ApiTags('Admin - Risk Levels')
@ApiBearerAuth('token')
@Controller('admin/risks')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
@Roles(Role.ADMIN)
export class AdminPoolController {
  constructor(
    private readonly poolStatistics: PoolStatisticsService,
    private readonly riskPoolMapping: RiskPoolMappingService,
    private readonly strategyEvaluationTask: StrategyEvaluationTask
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all risk level statistics',
    description: 'Returns statistics for all risk levels including user count, capital allocation, and strategy count.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Risk statistics retrieved successfully.'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Requires admin role.'
  })
  async getAllRisks() {
    return this.poolStatistics.getAllRiskStatistics();
  }

  @Get('distribution/users')
  @ApiOperation({
    summary: 'Get user distribution across risk levels',
    description: 'Shows percentage of enrolled users at each risk level.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User distribution retrieved successfully.'
  })
  async getUserDistribution() {
    return this.poolStatistics.getUserDistribution();
  }

  @Get('distribution/capital')
  @ApiOperation({
    summary: 'Get capital distribution across risk levels',
    description: 'Shows how total capital is allocated across risk levels.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Capital distribution retrieved successfully.'
  })
  async getCapitalDistribution() {
    return this.poolStatistics.getCapitalDistribution();
  }

  @Get(':riskId')
  @ApiOperation({
    summary: 'Get statistics for a specific risk level',
    description: 'Returns detailed statistics for a specific risk level by UUID.'
  })
  @ApiParam({
    name: 'riskId',
    description: 'The risk UUID',
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Risk statistics retrieved successfully.'
  })
  async getRiskStats(@Param('riskId') riskId: string) {
    return this.poolStatistics.getRiskStatistics(riskId);
  }

  @Get(':riskId/strategies')
  @ApiOperation({
    summary: 'Get all strategies for a risk level',
    description: 'Lists all active strategies assigned to the specified risk level.'
  })
  @ApiParam({
    name: 'riskId',
    description: 'The risk UUID',
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Strategies retrieved successfully.'
  })
  async getRiskStrategies(@Param('riskId') riskId: string) {
    return this.riskPoolMapping.getActiveStrategiesForRisk(riskId);
  }

  @Get(':riskId/users')
  @ApiOperation({
    summary: 'Get all users for a risk level',
    description: 'Lists all enrolled users with the specified risk level.'
  })
  @ApiParam({
    name: 'riskId',
    description: 'The risk UUID',
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Users retrieved successfully.'
  })
  async getRiskUsers(@Param('riskId') riskId: string) {
    const users = await this.riskPoolMapping.getUsersForRisk(riskId);

    // Return sanitized user data (exclude sensitive fields)
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      given_name: user.given_name,
      family_name: user.family_name,
      algoCapitalAllocationPercentage: user.algoCapitalAllocationPercentage,
      algoEnrolledAt: user.algoEnrolledAt,
      riskLevel: user.risk?.name
    }));
  }

  @Post(':riskId/rebalance')
  @ApiOperation({
    summary: 'Manually trigger risk level rebalance',
    description:
      'Forces a recalculation of strategy assignments for the risk level. Normally happens automatically during strategy evaluation.'
  })
  @ApiParam({
    name: 'riskId',
    description: 'The risk UUID to rebalance',
    type: String
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Risk level rebalanced successfully.'
  })
  async rebalanceRisk(@Param('riskId') riskId: string) {
    // Get all strategies assigned to this risk level
    const strategies = await this.riskPoolMapping.getActiveStrategiesForRisk(riskId);

    if (strategies.length === 0) {
      throw new NotFoundException(`No strategies found for risk level ${riskId}`);
    }

    // Queue each strategy for re-evaluation
    const queuedCount = await this.queueStrategiesForRebalance(strategies.map((s) => s.id));

    return {
      message: `Rebalance triggered for ${queuedCount} strategies`,
      riskId,
      strategiesQueued: queuedCount,
      note: 'Strategy re-evaluation will complete within a few minutes'
    };
  }

  /**
   * Queue strategies for re-evaluation during rebalance
   */
  private async queueStrategiesForRebalance(strategyIds: string[]): Promise<number> {
    let queuedCount = 0;
    for (const strategyId of strategyIds) {
      try {
        await this.strategyEvaluationTask.triggerEvaluation(strategyId);
        queuedCount++;
      } catch (error: unknown) {
        // Log but continue with other strategies
        const err = toErrorInfo(error);
        console.error(`Failed to queue strategy ${strategyId} for rebalance: ${err.message}`);
      }
    }
    return queuedCount;
  }
}
