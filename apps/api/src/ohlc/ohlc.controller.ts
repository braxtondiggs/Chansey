import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CoinIdParamDto, GetCandlesQueryDto } from './dto';
import { OHLCService } from './ohlc.service';
import { OHLCBackfillService } from './services/ohlc-backfill.service';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface OHLCHealthResponse {
  status: HealthStatus;
  lastSyncAt: string | null;
  coinsTracked: number;
  staleCoins: number;
  totalCandles: number;
  oldestCandle: string | null;
  newestCandle: string | null;
  details?: {
    gapsDetected?: number;
    failedMappings?: number;
  };
}

@ApiTags('OHLC')
@Controller('ohlc')
export class OHLCController {
  constructor(
    private readonly ohlcService: OHLCService,
    private readonly backfillService: OHLCBackfillService
  ) {}

  /**
   * Health check endpoint for OHLC system monitoring
   */
  @Get('health')
  @ApiOperation({ summary: 'Get OHLC system health status' })
  @ApiResponse({
    status: 200,
    description: 'OHLC system health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
        lastSyncAt: { type: 'string', nullable: true },
        coinsTracked: { type: 'number' },
        staleCoins: { type: 'number' },
        totalCandles: { type: 'number' },
        oldestCandle: { type: 'string', nullable: true },
        newestCandle: { type: 'string', nullable: true }
      }
    }
  })
  async getHealth(): Promise<OHLCHealthResponse> {
    const [syncStatus, staleCoins] = await Promise.all([
      this.ohlcService.getSyncStatus(),
      this.ohlcService.getStaleCoins(2) // Coins not synced in last 2 hours
    ]);

    // Determine health status
    let status: HealthStatus = 'healthy';

    // Check for issues
    const staleCount = staleCoins.length;
    const hoursSinceLastSync = syncStatus.lastSyncTime
      ? (Date.now() - syncStatus.lastSyncTime.getTime()) / (1000 * 60 * 60)
      : Infinity;

    if (hoursSinceLastSync > 4 || staleCount > syncStatus.coinsWithData * 0.5) {
      status = 'unhealthy';
    } else if (hoursSinceLastSync > 2 || staleCount > 10) {
      status = 'degraded';
    }

    return {
      status,
      lastSyncAt: syncStatus.lastSyncTime?.toISOString() || null,
      coinsTracked: syncStatus.coinsWithData,
      staleCoins: staleCount,
      totalCandles: syncStatus.totalCandles,
      oldestCandle: syncStatus.oldestCandle?.toISOString() || null,
      newestCandle: syncStatus.newestCandle?.toISOString() || null
    };
  }

  /**
   * Get sync status details
   */
  @Get('status')
  @ApiOperation({ summary: 'Get detailed OHLC sync status' })
  @Throttle({ medium: { ttl: 60000, limit: 10 } })
  async getSyncStatus() {
    const [syncStatus, staleCoins, gapSummary] = await Promise.all([
      this.ohlcService.getSyncStatus(),
      this.ohlcService.getStaleCoins(),
      this.ohlcService.getGapSummary()
    ]);

    return {
      sync: {
        totalCandles: syncStatus.totalCandles,
        coinsWithData: syncStatus.coinsWithData,
        oldestCandle: syncStatus.oldestCandle?.toISOString(),
        newestCandle: syncStatus.newestCandle?.toISOString(),
        lastSyncTime: syncStatus.lastSyncTime?.toISOString()
      },
      staleCoins: staleCoins.map((m) => ({
        coinId: m.coinId,
        symbol: m.symbol,
        lastSyncAt: m.lastSyncAt?.toISOString(),
        failureCount: m.failureCount
      })),
      gaps: {
        coinsWithGaps: gapSummary.length,
        details: gapSummary.slice(0, 10) // Limit to top 10
      }
    };
  }

  /**
   * Get backfill progress for a coin
   */
  @Get('backfill/:coinId')
  @ApiOperation({ summary: 'Get backfill progress for a specific coin' })
  @ApiParam({ name: 'coinId', description: 'Coin UUID' })
  async getBackfillProgress(@Param() params: CoinIdParamDto) {
    const { coinId } = params;
    const progress = await this.backfillService.getProgress(coinId);

    if (!progress) {
      return {
        coinId,
        status: 'not_started',
        message: 'No backfill has been started for this coin'
      };
    }

    return progress;
  }

  /**
   * Start backfill for a coin
   */
  @Post('backfill/:coinId')
  @ApiOperation({ summary: 'Start historical data backfill for a coin' })
  @ApiParam({ name: 'coinId', description: 'Coin UUID' })
  @Throttle({ medium: { ttl: 60000, limit: 5 } })
  async startBackfill(@Param() params: CoinIdParamDto) {
    const { coinId } = params;
    const jobId = await this.backfillService.startBackfill(coinId);

    return {
      success: true,
      jobId,
      message: `Backfill started for coin ${coinId}`
    };
  }

  /**
   * Resume a failed/cancelled backfill
   */
  @Post('backfill/:coinId/resume')
  @ApiOperation({ summary: 'Resume an interrupted backfill' })
  @ApiParam({ name: 'coinId', description: 'Coin UUID' })
  async resumeBackfill(@Param() params: CoinIdParamDto) {
    const { coinId } = params;
    await this.backfillService.resumeBackfill(coinId);

    return {
      success: true,
      message: `Backfill resumed for coin ${coinId}`
    };
  }

  /**
   * Cancel a running backfill
   */
  @Post('backfill/:coinId/cancel')
  @ApiOperation({ summary: 'Cancel a running backfill' })
  @ApiParam({ name: 'coinId', description: 'Coin UUID' })
  async cancelBackfill(@Param() params: CoinIdParamDto) {
    const { coinId } = params;
    await this.backfillService.cancelBackfill(coinId);

    return {
      success: true,
      message: `Backfill cancelled for coin ${coinId}`
    };
  }

  /**
   * Start backfill for hot coins
   */
  @Post('backfill/hot-coins')
  @ApiOperation({ summary: 'Start backfill for top coins by market cap' })
  @Throttle({ medium: { ttl: 60000, limit: 1 } })
  async backfillHotCoins() {
    const coinsQueued = await this.backfillService.backfillHotCoins();

    return {
      success: true,
      message: `Backfill started for ${coinsQueued} coins`
    };
  }

  /**
   * Get all active backfill jobs
   */
  @Get('backfill')
  @ApiOperation({ summary: 'Get all active backfill jobs' })
  async getAllBackfillProgress() {
    const jobs = await this.backfillService.getAllProgress();

    return {
      activeJobs: jobs.length,
      jobs
    };
  }

  /**
   * Get candles for a coin within a date range
   */
  @Get('candles/:coinId')
  @ApiOperation({ summary: 'Get OHLC candles for a coin' })
  @ApiParam({ name: 'coinId', description: 'Coin UUID' })
  @Throttle({ medium: { ttl: 60000, limit: 30 } })
  async getCandles(@Param() params: CoinIdParamDto, @Query() query: GetCandlesQueryDto) {
    const { coinId } = params;
    const startDate = new Date(query.start);
    const endDate = new Date(query.end);

    const candles = await this.ohlcService.getCandlesByDateRange([coinId], startDate, endDate);

    return {
      coinId,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      count: candles.length,
      candles: candles.map((c) => ({
        timestamp: c.timestamp.toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }))
    };
  }
}
