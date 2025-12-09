import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';

import { MarketRegimeService } from './market-regime.service';

import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';

/**
 * Market Regime Controller
 * Provides endpoints for market regime detection and history
 */
@ApiTags('market-regime')
@Controller('market-regime')
@UseGuards(JwtAuthenticationGuard)
@ApiBearerAuth()
export class MarketRegimeController {
  constructor(private readonly marketRegimeService: MarketRegimeService) {}

  @Get('current/:asset')
  @ApiOperation({ summary: 'Get current market regime for asset' })
  @ApiResponse({ status: 200, description: 'Current regime retrieved successfully' })
  @ApiResponse({ status: 404, description: 'No regime data available' })
  async getCurrentRegime(@Param('asset') asset: string) {
    return this.marketRegimeService.getCurrentRegime(asset);
  }

  @Get('history/:asset')
  @ApiOperation({ summary: 'Get regime history for asset' })
  @ApiResponse({ status: 200, description: 'Regime history retrieved successfully' })
  async getRegimeHistory(@Param('asset') asset: string, @Query('limit') limit?: number) {
    return this.marketRegimeService.getRegimeHistory(asset, limit ? parseInt(limit.toString()) : 50);
  }

  @Get('stats/:asset')
  @ApiOperation({ summary: 'Get regime statistics for asset' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  async getRegimeStats(@Param('asset') asset: string, @Query('days') days?: number) {
    return this.marketRegimeService.getRegimeStats(asset, days ? parseInt(days.toString()) : 365);
  }

  @Get('is-high-volatility/:asset')
  @ApiOperation({ summary: 'Check if asset is in high volatility regime' })
  @ApiResponse({ status: 200, description: 'Volatility status retrieved successfully' })
  async isHighVolatility(@Param('asset') asset: string) {
    const isHighVol = await this.marketRegimeService.isHighVolatilityRegime(asset);
    return { asset, isHighVolatility: isHighVol };
  }
}
