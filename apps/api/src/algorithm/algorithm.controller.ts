import {
  Body,
  Controller,
  Delete,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
  Query,
  Req
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags, ApiQuery } from '@nestjs/swagger';

import { AlgorithmService } from './algorithm.service';
import {
  CreateAlgorithmDto,
  UpdateAlgorithmDto,
  AlgorithmResponseDto,
  DeleteResponseDto,
  ActivateAlgorithmDto
} from './dto';
import { AlgorithmRegistry } from './registry/algorithm-registry.service';
import { AlgorithmActivationService } from './services/algorithm-activation.service';
import { AlgorithmContextBuilder } from './services/algorithm-context-builder.service';

import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';

@ApiTags('Algorithm')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@Controller('algorithm')
export class AlgorithmController {
  constructor(
    private readonly algorithmService: AlgorithmService,
    private readonly algorithmActivationService: AlgorithmActivationService,
    private readonly algorithmRegistry: AlgorithmRegistry,
    private readonly contextBuilder: AlgorithmContextBuilder
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Get all algorithms',
    description: 'Retrieve a list of all available algorithms with their strategies.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of algorithms retrieved successfully.',
    type: AlgorithmResponseDto,
    isArray: true
  })
  async getAlgorithms() {
    const algorithms = await this.algorithmService.getAlgorithms();
    const strategies = this.algorithmRegistry.getAllStrategies();

    return algorithms.map((algorithm) => {
      const strategy = strategies.find((s) => s.constructor.name === algorithm.service);
      return {
        ...algorithm,
        strategy: strategy
          ? {
              id: strategy.id,
              name: strategy.name,
              version: strategy.version,
              description: strategy.description,
              configSchema: strategy.getConfigSchema?.()
            }
          : null,
        hasStrategy: !!strategy
      };
    });
  }

  @Get('strategies')
  @ApiOperation({
    summary: 'Get all available strategies',
    description: 'Retrieve a list of all registered algorithm strategies.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of strategies retrieved successfully.'
  })
  async getStrategies() {
    const strategies = this.algorithmRegistry.getAllStrategies();
    return strategies.map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      className: strategy.constructor.name,
      version: strategy.version,
      description: strategy.description,
      configSchema: strategy.getConfigSchema?.()
    }));
  }

  @Get('health')
  @ApiOperation({
    summary: 'Get algorithm health status',
    description: 'Check the health status of all registered algorithms and strategies.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Health status retrieved successfully.'
  })
  async getHealthStatus() {
    const algorithms = await this.algorithmService.getActiveAlgorithms();
    const strategyHealth = await this.algorithmRegistry.getHealthStatus();

    return {
      totalAlgorithms: algorithms.length,
      activeAlgorithms: algorithms.filter((a) => a.status).length,
      strategyHealth,
      healthyStrategies: Object.values(strategyHealth).filter(Boolean).length,
      totalStrategies: Object.keys(strategyHealth).length,
      timestamp: new Date()
    };
  }

  @Post(':id/execute')
  @ApiOperation({
    summary: 'Execute an algorithm',
    description: 'Execute a specific algorithm with current market data.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiQuery({
    name: 'minimal',
    description: 'Use minimal context for faster execution',
    required: false,
    type: 'boolean'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm executed successfully.'
  })
  async executeAlgorithm(@Param('id', ParseUUIDPipe) algorithmId: string, @Query('minimal') minimal?: boolean) {
    const algorithm = await this.algorithmService.getAlgorithmById(algorithmId);

    // Build execution context
    const context = minimal
      ? await this.contextBuilder.buildMinimalContext(algorithm)
      : await this.contextBuilder.buildContext(algorithm);

    // Validate context
    if (!this.contextBuilder.validateContext(context)) {
      throw new Error('Invalid execution context');
    }

    // Execute algorithm
    const result = await this.algorithmRegistry.executeAlgorithm(algorithmId, context);

    return {
      algorithm: {
        id: algorithm.id,
        name: algorithm.name,
        service: algorithm.service || 'Unknown'
      },
      execution: result,
      context: {
        timestamp: context.timestamp,
        coinsAnalyzed: context.coins.length,
        priceDataPoints: Object.keys(context.priceData).length
      }
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get algorithm by ID',
    description: 'Retrieve a specific algorithm with its strategy information.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm retrieved successfully.',
    type: AlgorithmResponseDto
  })
  async getAlgorithmById(@Param('id', ParseUUIDPipe) algorithmId: string) {
    const algorithm = await this.algorithmService.getAlgorithmById(algorithmId);
    const strategies = this.algorithmRegistry.getAllStrategies();
    const strategy = strategies.find((s) => s.constructor.name === algorithm.service);

    return {
      ...algorithm,
      strategy: strategy
        ? {
            id: strategy.id,
            name: strategy.name,
            version: strategy.version,
            description: strategy.description,
            configSchema: strategy.getConfigSchema?.()
          }
        : null,
      hasStrategy: !!strategy
    };
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Create a new algorithm',
    description: 'Create a new algorithm configuration.'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Algorithm created successfully.',
    type: AlgorithmResponseDto
  })
  async createAlgorithm(@Body() createAlgorithmDto: CreateAlgorithmDto) {
    return await this.algorithmService.create(createAlgorithmDto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Update an algorithm',
    description: 'Update an existing algorithm configuration.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm updated successfully.',
    type: AlgorithmResponseDto
  })
  async updateAlgorithm(
    @Param('id', ParseUUIDPipe) algorithmId: string,
    @Body() updateAlgorithmDto: UpdateAlgorithmDto
  ) {
    return await this.algorithmService.update(algorithmId, updateAlgorithmDto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Delete an algorithm',
    description: 'Delete an algorithm configuration.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm deleted successfully.',
    type: DeleteResponseDto
  })
  async deleteAlgorithm(@Param('id', ParseUUIDPipe) algorithmId: string) {
    return await this.algorithmService.remove(algorithmId);
  }

  @Get('active')
  @ApiOperation({
    summary: 'Get active algorithms',
    description: 'Retrieve all active algorithm activations for the authenticated user.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Active algorithms retrieved successfully.'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated.'
  })
  async getActiveAlgorithms(@Req() request: any) {
    const userId = request.user.id;
    return await this.algorithmActivationService.findUserActiveAlgorithms(userId);
  }

  @Post(':id/activate')
  @ApiOperation({
    summary: 'Activate an algorithm',
    description: 'Activate an algorithm for automated trading with a specific exchange key.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Algorithm activated successfully.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Algorithm is already activated or exchange key not found.'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated.'
  })
  async activateAlgorithm(
    @Param('id', ParseUUIDPipe) algorithmId: string,
    @Body() activateAlgorithmDto: ActivateAlgorithmDto,
    @Req() request: any
  ) {
    const userId = request.user.id;
    return await this.algorithmActivationService.activate(
      userId,
      algorithmId,
      activateAlgorithmDto.exchangeKeyId,
      activateAlgorithmDto.config
    );
  }

  @Post(':id/deactivate')
  @ApiOperation({
    summary: 'Deactivate an algorithm',
    description: 'Deactivate an active algorithm to stop automated trading.'
  })
  @ApiParam({
    name: 'id',
    description: 'Algorithm ID',
    type: 'string'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Algorithm deactivated successfully.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Algorithm is not active or activation not found.'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated.'
  })
  async deactivateAlgorithm(@Param('id', ParseUUIDPipe) algorithmId: string, @Req() request: any) {
    const userId = request.user.id;
    return await this.algorithmActivationService.deactivate(userId, algorithmId);
  }
}
