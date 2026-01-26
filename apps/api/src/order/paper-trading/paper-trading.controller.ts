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
  UseGuards
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import {
  CreatePaperTradingSessionDto,
  PaperTradingBalanceDto,
  PaperTradingListResponseDto,
  PaperTradingMetricsDto,
  PaperTradingOrderDto,
  PaperTradingOrderFiltersDto,
  PaperTradingPositionDto,
  PaperTradingSessionDetailDto,
  PaperTradingSessionFiltersDto,
  PaperTradingSessionSummaryDto,
  PaperTradingSignalDto,
  PaperTradingSignalFiltersDto,
  PaperTradingSnapshotDto,
  PaperTradingSnapshotFiltersDto,
  UpdatePaperTradingSessionDto
} from './dto';
import { PaperTradingService } from './paper-trading.service';

import GetUser from '../../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../../authentication/guard/jwt-authentication.guard';
import { User } from '../../users/users.entity';

@ApiTags('Paper Trading')
@Controller('paper-trading')
@UseGuards(JwtAuthenticationGuard)
@ApiBearerAuth()
export class PaperTradingController {
  constructor(private readonly paperTradingService: PaperTradingService) {}

  @Post('sessions')
  @ApiOperation({ summary: 'Create a new paper trading session' })
  @ApiResponse({ status: 201, description: 'Session created successfully', type: PaperTradingSessionDetailDto })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  @ApiResponse({ status: 404, description: 'Algorithm or exchange key not found' })
  async create(
    @Body() dto: CreatePaperTradingSessionDto,
    @GetUser() user: User
  ): Promise<PaperTradingSessionDetailDto> {
    const session = await this.paperTradingService.create(dto, user);
    return this.toDetailDto(session);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List paper trading sessions' })
  @ApiResponse({ status: 200, description: 'Sessions retrieved successfully', type: PaperTradingListResponseDto })
  async findAll(
    @Query() filters: PaperTradingSessionFiltersDto,
    @GetUser() user: User
  ): Promise<PaperTradingListResponseDto> {
    const { data, total } = await this.paperTradingService.findAll(user, filters);
    return {
      data: data.map((s) => this.toSummaryDto(s)),
      total,
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0
    };
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'Get a paper trading session by ID' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session retrieved successfully', type: PaperTradingSessionDetailDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<PaperTradingSessionDetailDto> {
    const session = await this.paperTradingService.findOne(id, user);
    return this.toDetailDto(session);
  }

  @Put('sessions/:id')
  @ApiOperation({ summary: 'Update a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session updated successfully', type: PaperTradingSessionDetailDto })
  @ApiResponse({ status: 400, description: 'Cannot update active session' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaperTradingSessionDto,
    @GetUser() user: User
  ): Promise<PaperTradingSessionDetailDto> {
    const session = await this.paperTradingService.update(id, dto, user);
    return this.toDetailDto(session);
  }

  @Delete('sessions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 204, description: 'Session deleted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot delete active session' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async delete(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<void> {
    await this.paperTradingService.delete(id, user);
  }

  @Post('sessions/:id/start')
  @ApiOperation({ summary: 'Start a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session started successfully', type: PaperTradingSessionDetailDto })
  @ApiResponse({ status: 400, description: 'Session already active or completed' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async start(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<PaperTradingSessionDetailDto> {
    const session = await this.paperTradingService.start(id, user);
    return this.toDetailDto(session);
  }

  @Post('sessions/:id/pause')
  @ApiOperation({ summary: 'Pause a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session paused successfully', type: PaperTradingSessionDetailDto })
  @ApiResponse({ status: 400, description: 'Session not active' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async pause(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<PaperTradingSessionDetailDto> {
    const session = await this.paperTradingService.pause(id, user);
    return this.toDetailDto(session);
  }

  @Post('sessions/:id/resume')
  @ApiOperation({ summary: 'Resume a paused paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session resumed successfully', type: PaperTradingSessionDetailDto })
  @ApiResponse({ status: 400, description: 'Session not paused' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async resume(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<PaperTradingSessionDetailDto> {
    const session = await this.paperTradingService.resume(id, user);
    return this.toDetailDto(session);
  }

  @Post('sessions/:id/stop')
  @ApiOperation({ summary: 'Stop a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Session stopped successfully', type: PaperTradingSessionDetailDto })
  @ApiResponse({ status: 400, description: 'Session already stopped' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async stop(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<PaperTradingSessionDetailDto> {
    const session = await this.paperTradingService.stop(id, user);
    return this.toDetailDto(session);
  }

  @Get('sessions/:id/orders')
  @ApiOperation({ summary: 'Get orders for a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Orders retrieved successfully', type: [PaperTradingOrderDto] })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getOrders(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: PaperTradingOrderFiltersDto,
    @GetUser() user: User
  ): Promise<{ data: PaperTradingOrderDto[]; total: number }> {
    const { data, total } = await this.paperTradingService.getOrders(id, user, filters);
    return {
      data: data.map((o) => ({
        id: o.id,
        side: o.side,
        orderType: o.orderType,
        status: o.status,
        symbol: o.symbol,
        baseCurrency: o.baseCurrency,
        quoteCurrency: o.quoteCurrency,
        requestedQuantity: o.requestedQuantity,
        filledQuantity: o.filledQuantity,
        executedPrice: o.executedPrice,
        slippageBps: o.slippageBps,
        fee: o.fee,
        totalValue: o.totalValue,
        realizedPnL: o.realizedPnL,
        realizedPnLPercent: o.realizedPnLPercent,
        createdAt: o.createdAt,
        executedAt: o.executedAt,
        signalId: o.signal?.id
      })),
      total
    };
  }

  @Get('sessions/:id/signals')
  @ApiOperation({ summary: 'Get signals for a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Signals retrieved successfully', type: [PaperTradingSignalDto] })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getSignals(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: PaperTradingSignalFiltersDto,
    @GetUser() user: User
  ): Promise<{ data: PaperTradingSignalDto[]; total: number }> {
    const { data, total } = await this.paperTradingService.getSignals(id, user, filters);
    return {
      data: data.map((s) => ({
        id: s.id,
        signalType: s.signalType,
        direction: s.direction,
        instrument: s.instrument,
        quantity: s.quantity,
        price: s.price,
        confidence: s.confidence,
        reason: s.reason,
        processed: s.processed,
        createdAt: s.createdAt,
        processedAt: s.processedAt
      })),
      total
    };
  }

  @Get('sessions/:id/balance')
  @ApiOperation({ summary: 'Get virtual balances for a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Balances retrieved successfully', type: [PaperTradingBalanceDto] })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getBalance(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<PaperTradingBalanceDto[]> {
    const accounts = await this.paperTradingService.getBalances(id, user);
    return accounts.map((a) => ({
      currency: a.currency,
      available: a.available,
      locked: a.locked,
      total: a.total,
      averageCost: a.averageCost
    }));
  }

  @Get('sessions/:id/positions')
  @ApiOperation({ summary: 'Get current positions for a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Positions retrieved successfully', type: [PaperTradingPositionDto] })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getPositions(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser() user: User
  ): Promise<PaperTradingPositionDto[]> {
    const positions = await this.paperTradingService.getPositions(id, user);
    return positions.map((p) => ({
      symbol: p.symbol,
      quantity: p.quantity,
      averageCost: p.averageCost,
      currentPrice: p.currentPrice ?? 0,
      marketValue: p.marketValue ?? 0,
      unrealizedPnL: p.unrealizedPnL ?? 0,
      unrealizedPnLPercent: p.unrealizedPnLPercent ?? 0
    }));
  }

  @Get('sessions/:id/performance')
  @ApiOperation({ summary: 'Get performance metrics for a paper trading session' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved successfully', type: PaperTradingMetricsDto })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getPerformance(@Param('id', ParseUUIDPipe) id: string, @GetUser() user: User): Promise<PaperTradingMetricsDto> {
    const metrics = await this.paperTradingService.getPerformance(id, user);
    return {
      ...metrics,
      totalReturnPercent: metrics.totalReturnPercent ?? (metrics.totalReturn / metrics.initialCapital) * 100
    };
  }

  @Get('sessions/:id/snapshots')
  @ApiOperation({ summary: 'Get portfolio snapshots for charting' })
  @ApiParam({ name: 'id', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'Snapshots retrieved successfully', type: [PaperTradingSnapshotDto] })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async getSnapshots(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() filters: PaperTradingSnapshotFiltersDto,
    @GetUser() user: User
  ): Promise<PaperTradingSnapshotDto[]> {
    const snapshots = await this.paperTradingService.getSnapshots(id, user, filters);
    return snapshots.map((s) => ({
      id: s.id,
      portfolioValue: s.portfolioValue,
      cashBalance: s.cashBalance,
      holdings: s.holdings,
      cumulativeReturn: s.cumulativeReturn,
      drawdown: s.drawdown,
      unrealizedPnL: s.unrealizedPnL,
      realizedPnL: s.realizedPnL,
      timestamp: s.timestamp
    }));
  }

  /**
   * Map session entity to summary DTO
   */
  private toSummaryDto(session: any): PaperTradingSessionSummaryDto {
    return {
      id: session.id,
      name: session.name,
      status: session.status,
      initialCapital: session.initialCapital,
      currentPortfolioValue: session.currentPortfolioValue,
      totalReturn: session.totalReturn,
      maxDrawdown: session.maxDrawdown,
      totalTrades: session.totalTrades ?? 0,
      algorithmName: session.algorithm?.name ?? 'Unknown',
      exchangeName: session.exchangeKey?.exchange?.name ?? 'Unknown',
      createdAt: session.createdAt,
      startedAt: session.startedAt
    };
  }

  /**
   * Map session entity to detail DTO
   */
  private toDetailDto(session: any): PaperTradingSessionDetailDto {
    return {
      ...this.toSummaryDto(session),
      description: session.description,
      peakPortfolioValue: session.peakPortfolioValue,
      sharpeRatio: session.sharpeRatio,
      winRate: session.winRate,
      winningTrades: session.winningTrades ?? 0,
      losingTrades: session.losingTrades ?? 0,
      tradingFee: session.tradingFee,
      pipelineId: session.pipelineId,
      duration: session.duration,
      stopConditions: session.stopConditions,
      stoppedReason: session.stoppedReason,
      algorithmConfig: session.algorithmConfig,
      tickIntervalMs: session.tickIntervalMs,
      lastTickAt: session.lastTickAt,
      tickCount: session.tickCount ?? 0,
      errorMessage: session.errorMessage,
      pausedAt: session.pausedAt,
      stoppedAt: session.stoppedAt,
      completedAt: session.completedAt,
      algorithmId: session.algorithm?.id,
      exchangeKeyId: session.exchangeKey?.id
    };
  }
}
