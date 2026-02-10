import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateStrategyConfigDto, StrategyConfigListFilters, UpdateStrategyConfigDto } from '@chansey/api-interfaces';

import { StrategyService } from './strategy.service';

import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';

/**
 * Strategy Controller
 * Manages strategy configurations (CRUD operations)
 */
@ApiTags('strategies')
@Controller('strategies')
@UseGuards(JwtAuthenticationGuard)
@ApiBearerAuth('token')
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new strategy configuration' })
  @ApiResponse({ status: 201, description: 'Strategy created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 404, description: 'Algorithm not found' })
  async create(@Body() dto: CreateStrategyConfigDto, @Request() req) {
    return this.strategyService.create(dto, req.user?.userId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all strategy configurations with filters' })
  @ApiResponse({ status: 200, description: 'Strategies retrieved successfully' })
  async findAll(@Query() filters: StrategyConfigListFilters) {
    return this.strategyService.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get strategy configuration by ID' })
  @ApiResponse({ status: 200, description: 'Strategy retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Strategy not found' })
  async findOne(@Param('id') id: string) {
    return this.strategyService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update strategy configuration' })
  @ApiResponse({ status: 200, description: 'Strategy updated successfully' })
  @ApiResponse({ status: 404, description: 'Strategy not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateStrategyConfigDto, @Request() req) {
    return this.strategyService.update(id, dto, req.user?.userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete strategy configuration' })
  @ApiResponse({ status: 204, description: 'Strategy deleted successfully' })
  @ApiResponse({ status: 404, description: 'Strategy not found' })
  async delete(@Param('id') id: string, @Request() req) {
    await this.strategyService.delete(id, req.user?.userId);
    return { message: 'Strategy deleted successfully' };
  }

  @Get(':id/latest-backtest')
  @ApiOperation({ summary: 'Get latest backtest run for strategy' })
  @ApiResponse({ status: 200, description: 'Backtest run retrieved successfully' })
  async getLatestBacktest(@Param('id') id: string) {
    return this.strategyService.getLatestBacktestRun(id);
  }

  @Get(':id/latest-score')
  @ApiOperation({ summary: 'Get latest score for strategy' })
  @ApiResponse({ status: 200, description: 'Score retrieved successfully' })
  async getLatestScore(@Param('id') id: string) {
    return this.strategyService.getLatestScore(id);
  }
}
