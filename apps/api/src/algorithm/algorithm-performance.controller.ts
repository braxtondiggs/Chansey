import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { AlgorithmPerformanceQueryDto, PerformancePeriod } from './dto/algorithm-performance-query.dto';
import { AlgorithmActivationService } from './services/algorithm-activation.service';
import { AlgorithmPerformanceService } from './services/algorithm-performance.service';

import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';

/**
 * AlgorithmPerformanceController
 *
 * Handles endpoints for algorithm performance metrics and rankings.
 */
@ApiTags('Algorithm Performance')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@Controller('algorithm')
export class AlgorithmPerformanceController {
  constructor(
    private readonly algorithmActivationService: AlgorithmActivationService,
    private readonly algorithmPerformanceService: AlgorithmPerformanceService
  ) {}

  @Get(':id/performance')
  @ApiOperation({
    summary: 'Get algorithm performance metrics',
    description: 'Retrieve current performance metrics for a specific algorithm activation.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: PerformancePeriod,
    description: 'Time period for metrics (defaults to 30d)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Performance metrics retrieved successfully.'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Algorithm not activated or performance data not available.'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated.'
  })
  async getPerformance(
    @Param('id', ParseUUIDPipe) algorithmId: string,
    @Query() query: AlgorithmPerformanceQueryDto,
    @Req() request: any
  ) {
    const userId = request.user.id;

    // Find activation for this user and algorithm
    const activations = await this.algorithmActivationService.findUserAlgorithms(userId);
    const activation = activations.find((a) => a.algorithmId === algorithmId);

    if (!activation) {
      return {
        message: 'Algorithm not activated',
        performance: null
      };
    }

    // Get latest performance
    const performance = await this.algorithmPerformanceService.getLatestPerformance(activation.id);

    if (!performance) {
      // If no performance data exists, calculate it
      const newPerformance = await this.algorithmPerformanceService.calculatePerformance(activation.id);
      return newPerformance;
    }

    return performance;
  }

  @Get(':id/performance/history')
  @ApiOperation({
    summary: 'Get algorithm performance history',
    description: 'Retrieve historical performance metrics as a time-series dataset.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiQuery({
    name: 'from',
    required: false,
    description: 'Start date (ISO 8601 format)',
    type: 'string'
  })
  @ApiQuery({
    name: 'to',
    required: false,
    description: 'End date (ISO 8601 format)',
    type: 'string'
  })
  @ApiQuery({
    name: 'interval',
    required: false,
    description: 'Data interval (5m, 1h, 1d)',
    type: 'string'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Performance history retrieved successfully.',
    isArray: true
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Algorithm not activated.'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated.'
  })
  async getPerformanceHistory(
    @Param('id', ParseUUIDPipe) algorithmId: string,
    @Query() query: AlgorithmPerformanceQueryDto,
    @Req() request: any
  ) {
    const userId = request.user.id;

    // Find activation for this user and algorithm
    const activations = await this.algorithmActivationService.findUserAlgorithms(userId);
    const activation = activations.find((a) => a.algorithmId === algorithmId);

    if (!activation) {
      return {
        message: 'Algorithm not activated',
        history: []
      };
    }

    // Parse date range
    const to = query.to ? new Date(query.to) : new Date();
    let from: Date;

    if (query.from) {
      from = new Date(query.from);
    } else {
      // Default to 30 days ago
      from = new Date();
      from.setDate(from.getDate() - 30);
    }

    // Get performance history
    const history = await this.algorithmPerformanceService.getPerformanceHistory(activation.id, from, to);

    return history;
  }

  @Get('rankings')
  @ApiOperation({
    summary: 'Get algorithm rankings',
    description: 'Retrieve performance rankings for all active algorithms owned by the user, sorted by rank.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Rankings retrieved successfully.',
    isArray: true
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated.'
  })
  async getRankings(@Req() request: any) {
    const userId = request.user.id;

    // Get all performance records with rankings for this user
    const rankings = await this.algorithmPerformanceService.getUserRankings(userId);

    // Enrich with activation details
    const enrichedRankings = await Promise.all(
      rankings.map(async (performance) => {
        const activation = await this.algorithmActivationService.findById(performance.algorithmActivationId);

        return {
          ...performance,
          algorithm: activation.algorithm,
          allocationPercentage: activation.allocationPercentage,
          isActive: activation.isActive
        };
      })
    );

    return enrichedRankings;
  }
}
