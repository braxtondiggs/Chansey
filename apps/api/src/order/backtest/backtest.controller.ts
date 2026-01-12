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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  BacktestRunCollection,
  BacktestRunDetail,
  BacktestSignalCollection,
  SimulatedOrderFillCollection
} from '@chansey/api-interfaces';

import { Backtest } from './backtest.entity';
import { BacktestService } from './backtest.service';
import {
  BacktestComparisonDto,
  BacktestFiltersDto,
  BacktestPerformanceDto,
  BacktestProgressDto,
  BacktestSignalQueryDto,
  BacktestTradesQueryDto,
  CreateBacktestDto,
  CreateComparisonReportDto,
  UpdateBacktestDto
} from './dto/backtest.dto';

import GetUser from '../../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../../authentication/guard/jwt-authentication.guard';
import { User } from '../../users/users.entity';

@ApiTags('Backtests')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
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
    @GetUser() user: User,
    @Body(new ValidationPipe({ transform: true })) createBacktestDto: CreateBacktestDto
  ): Promise<BacktestRunDetail> {
    return this.backtestService.createBacktest(user, createBacktestDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all backtests with optional filtering' })
  @ApiResponse({ status: HttpStatus.OK })
  async getBacktests(
    @GetUser() user: User,
    @Query(new ValidationPipe({ transform: true })) filters: BacktestFiltersDto
  ): Promise<BacktestRunCollection> {
    return this.backtestService.getBacktests(user, filters);
  }

  @Get('datasets')
  @ApiOperation({ summary: 'List available market data sets for backtesting' })
  async getDatasets(@GetUser() user: User) {
    return this.backtestService.getDatasets(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific backtest with detailed information' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async getBacktest(
    @GetUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string
  ): Promise<BacktestRunDetail> {
    return this.backtestService.getBacktest(user, id);
  }

  @Get(':id/signals')
  @ApiOperation({ summary: 'Get signals emitted during a backtest run' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getBacktestSignals(
    @GetUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(new ValidationPipe({ transform: true })) query: BacktestSignalQueryDto
  ): Promise<BacktestSignalCollection> {
    return this.backtestService.getBacktestSignals(user, id, query);
  }

  @Get(':id/trades')
  @ApiOperation({ summary: 'Get simulated order fills for a backtest run' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async getBacktestTrades(
    @GetUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(new ValidationPipe({ transform: true })) query: BacktestTradesQueryDto
  ): Promise<SimulatedOrderFillCollection> {
    return this.backtestService.getBacktestTrades(user, id, query);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: Backtest })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async updateBacktest(
    @GetUser() user: User,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(new ValidationPipe({ transform: true })) updateBacktestDto: UpdateBacktestDto
  ) {
    return this.backtestService.updateBacktest(user, id, updateBacktestDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async deleteBacktest(@GetUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.backtestService.deleteBacktest(user, id);
  }

  @Get(':id/performance')
  @ApiOperation({ summary: 'Get detailed performance metrics for a backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: BacktestPerformanceDto })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Backtest not found' })
  async getBacktestPerformance(@GetUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.backtestService.getBacktestPerformance(user, id);
  }

  @Post('compare')
  @ApiOperation({ summary: 'Compare multiple backtests' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Comparison results' })
  async compareBacktests(
    @GetUser() user: User,
    @Body(new ValidationPipe({ transform: true })) comparisonDto: BacktestComparisonDto
  ) {
    return this.backtestService.compareBacktests(user, comparisonDto);
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Get progress of a running backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, type: BacktestProgressDto })
  async getBacktestProgress(@GetUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.backtestService.getBacktestProgress(user, id);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a running backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Backtest cancelled' })
  async cancelBacktest(@GetUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.backtestService.cancelBacktest(user, id);
    return { message: 'Backtest cancelled successfully' };
  }

  @Post(':id/resume')
  @ApiOperation({ summary: 'Resume a paused backtest' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  async resumeBacktest(@GetUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.backtestService.resumeBacktest(user, id);
  }
}

@ApiTags('Comparison Reports')
@ApiBearerAuth('token')
@UseGuards(JwtAuthenticationGuard)
@Controller('comparison-reports')
export class ComparisonReportController {
  constructor(private readonly backtestService: BacktestService) {}

  @Post()
  @ApiOperation({ summary: 'Create a comparison report' })
  async createReport(
    @GetUser() user: User,
    @Body(new ValidationPipe({ transform: true })) dto: CreateComparisonReportDto
  ) {
    return this.backtestService.createComparisonReport(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a comparison report' })
  async getReport(@GetUser() user: User, @Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.backtestService.getComparisonReport(user, id);
  }
}
