import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  ValidationPipe
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  BacktestRunCollection,
  BacktestRunDetail,
  BacktestSignalCollection,
  SimulatedOrderFillCollection
} from '@chansey/api-interfaces';

import { Backtest } from './backtest.entity';
import { BacktestService } from './backtest.service';
import {
  CreateBacktestDto,
  UpdateBacktestDto,
  BacktestFiltersDto,
  BacktestPerformanceDto,
  BacktestComparisonDto,
  BacktestProgressDto,
  CreateComparisonReportDto,
  BacktestSignalQueryDto,
  BacktestTradesQueryDto
} from './dto/backtest.dto';

import { APIAuthenticationGuard } from '../../authentication/guard/api-authentication.guard';
import { User } from '../../users/users.entity';

@ApiTags('Backtests')
@UseGuards(APIAuthenticationGuard)
@ApiSecurity('api-key')
@Controller('backtests')
export class BacktestController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Create a new backtest',
    description: 'Creates a comprehensive backtest run with historical data and performance analysis'
  })
  @ApiResponse({ status: HttpStatus.ACCEPTED })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid backtest parameters' })
  async createBacktest(
    @Body(new ValidationPipe({ transform: true })) createBacktestDto: CreateBacktestDto
  ): Promise<BacktestRunDetail> {
    // TODO: Add user context when authentication decorator is available
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.createBacktest(mockUser, createBacktestDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all backtests with optional filtering' })
  @ApiResponse({ status: HttpStatus.OK })
  async getBacktests(
    @Query(new ValidationPipe({ transform: true })) filters: BacktestFiltersDto
  ): Promise<BacktestRunCollection> {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getBacktests(mockUser, filters);
  }

  @Get('datasets')
  @ApiOperation({ summary: 'List available market data sets for backtesting' })
  async getDatasets() {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getDatasets(mockUser);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific backtest with detailed information' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async getBacktest(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string): Promise<BacktestRunDetail> {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getBacktest(mockUser, id);
  }

  @Get(':id/signals')
  @ApiOperation({ summary: 'Get signals emitted during a backtest run' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getBacktestSignals(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(new ValidationPipe({ transform: true })) query: BacktestSignalQueryDto
  ): Promise<BacktestSignalCollection> {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getBacktestSignals(mockUser, id, query);
  }

  @Get(':id/trades')
  @ApiOperation({ summary: 'Get simulated order fills for a backtest run' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getBacktestTrades(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(new ValidationPipe({ transform: true })) query: BacktestTradesQueryDto
  ): Promise<SimulatedOrderFillCollection> {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getBacktestTrades(mockUser, id, query);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: Backtest })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async updateBacktest(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ValidationPipe({ transform: true })) updateBacktestDto: UpdateBacktestDto
  ) {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.updateBacktest(mockUser, id, updateBacktestDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async deleteBacktest(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const mockUser = { id: 'test-user-id' } as User;
    await this.backtestService.deleteBacktest(mockUser, id);
  }

  @Get(':id/performance')
  @ApiOperation({ summary: 'Get detailed performance metrics for a backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: BacktestPerformanceDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async getBacktestPerformance(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getBacktestPerformance(mockUser, id);
  }

  @Post('compare')
  @ApiOperation({ summary: 'Compare multiple backtests' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Comparison results' })
  async compareBacktests(@Body(new ValidationPipe({ transform: true })) comparisonDto: BacktestComparisonDto) {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.compareBacktests(mockUser, comparisonDto);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Get progress of a running backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: BacktestProgressDto })
  async getBacktestProgress(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getBacktestProgress(mockUser, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a running backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Backtest cancelled' })
  async cancelBacktest(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const mockUser = { id: 'test-user-id' } as User;
    await this.backtestService.cancelBacktest(mockUser, id);
    return { message: 'Backtest cancelled successfully' };
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async resumeBacktest(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.resumeBacktest(mockUser, id);
  }
}

@ApiTags('Comparison Reports')
@UseGuards(APIAuthenticationGuard)
@ApiSecurity('api-key')
@Controller('comparison-reports')
export class ComparisonReportController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post()
  @ApiOperation({ summary: 'Create a comparison report' })
  async createReport(@Body(new ValidationPipe({ transform: true })) dto: CreateComparisonReportDto) {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.createComparisonReport(mockUser, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a comparison report' })
  async getReport(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const mockUser = { id: 'test-user-id' } as User;
    return this.backtestService.getComparisonReport(mockUser, id);
  }
}
