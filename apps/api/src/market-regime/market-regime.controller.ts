import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Role } from '@chansey/api-interfaces';

import { CompositeRegimeService } from './composite-regime.service';
import { DisableRegimeGateOverrideDto, RegimeGateOverrideDto } from './dto/regime-gate-override.dto';
import { MarketRegimeService } from './market-regime.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import { Roles } from '../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../authentication/guard/roles.guard';
import { User } from '../users/users.entity';

/**
 * Market Regime Controller
 * Provides endpoints for market regime detection and history
 */
@ApiTags('market-regime')
@Controller('market-regime')
@UseGuards(JwtAuthenticationGuard)
@ApiBearerAuth('token')
export class MarketRegimeController {
  constructor(
    private readonly marketRegimeService: MarketRegimeService,
    private readonly compositeRegimeService: CompositeRegimeService
  ) {}

  @Get('current/:asset')
  @ApiOperation({ summary: 'Get current market regime for asset' })
  @ApiResponse({ status: 200, description: 'Current regime retrieved successfully' })
  @ApiResponse({ status: 404, description: 'No regime data available' })
  async getCurrentRegime(@Param('asset') asset: string) {
    return this.marketRegimeService.getCurrentRegime(asset);
  }

  @Get('composite/current')
  @ApiOperation({ summary: 'Get current composite regime (volatility + trend)' })
  @ApiResponse({ status: 200, description: 'Composite regime status retrieved' })
  getCompositeRegime() {
    return this.compositeRegimeService.getStatus();
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

  @Post('regime-gate/override')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Enable regime gate override (admin only)' })
  @ApiResponse({ status: 200, description: 'Override enabled' })
  async enableOverride(@GetUser() user: User, @Body() dto: RegimeGateOverrideDto) {
    await this.compositeRegimeService.enableOverride(user.id, dto.forceAllow, dto.reason);
    return { success: true, message: 'Regime gate override enabled' };
  }

  @Delete('regime-gate/override')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Clear regime gate override (admin only)' })
  @ApiResponse({ status: 200, description: 'Override cleared' })
  async disableOverride(@GetUser() user: User, @Body() dto: DisableRegimeGateOverrideDto) {
    await this.compositeRegimeService.disableOverride(user.id, dto.reason || 'Override cleared');
    return { success: true, message: 'Regime gate override disabled' };
  }
}
