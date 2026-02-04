import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Role } from '@chansey/api-interfaces';

import { HaltTradingDto } from './dto/halt-trading.dto';
import { ResumeTradingDto } from './dto/resume-trading.dto';
import { CancelAllOrdersResponseDto, TradingStateResponseDto } from './dto/trading-state-response.dto';
import { TradingStateService } from './trading-state.service';

import GetUser from '../../authentication/decorator/get-user.decorator';
import { Roles } from '../../authentication/decorator/roles.decorator';
import { JwtAuthenticationGuard } from '../../authentication/guard/jwt-authentication.guard';
import { RolesGuard } from '../../authentication/guard/roles.guard';
import { User } from '../../users/users.entity';

/**
 * Admin controller for global trading kill switch.
 *
 * All endpoints require admin role and are audited.
 * These are emergency controls - use with caution.
 */
@ApiTags('Admin - Trading Control')
@ApiBearerAuth('token')
@Controller('admin/trading')
@UseGuards(JwtAuthenticationGuard, RolesGuard)
@Roles(Role.ADMIN)
export class TradingStateController {
  constructor(private readonly tradingStateService: TradingStateService) {}

  /**
   * Get current trading state
   */
  @Get('status')
  @ApiOperation({
    summary: 'Get current trading state',
    description: 'Returns the current global trading state including halt status, last actions, and halt count.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Current trading state',
    type: TradingStateResponseDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async getStatus(): Promise<TradingStateResponseDto> {
    const state = await this.tradingStateService.getState();

    return {
      id: state.id,
      tradingEnabled: state.tradingEnabled,
      haltedAt: state.haltedAt,
      haltedBy: state.haltedBy,
      haltReason: state.haltReason,
      resumedAt: state.resumedAt,
      resumedBy: state.resumedBy,
      resumeReason: state.resumeReason,
      haltCount: state.haltCount,
      metadata: state.metadata,
      updatedAt: state.updatedAt,
      haltDurationMs: state.isHalted && state.haltedAt ? Date.now() - state.haltedAt.getTime() : undefined
    };
  }

  /**
   * Emergency halt all trading
   */
  @Post('halt')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Emergency halt all trading',
    description:
      'Immediately halts all algorithmic trading system-wide. ' +
      'Optionally pauses all deployments and cancels open orders. ' +
      'This action is logged in the audit trail.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trading halted successfully',
    type: TradingStateResponseDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async haltTrading(@Body() dto: HaltTradingDto, @GetUser() user: User): Promise<TradingStateResponseDto> {
    const state = await this.tradingStateService.haltTrading(user.id, dto);

    return {
      id: state.id,
      tradingEnabled: state.tradingEnabled,
      haltedAt: state.haltedAt,
      haltedBy: state.haltedBy,
      haltReason: state.haltReason,
      resumedAt: state.resumedAt,
      resumedBy: state.resumedBy,
      resumeReason: state.resumeReason,
      haltCount: state.haltCount,
      metadata: state.metadata,
      updatedAt: state.updatedAt,
      haltDurationMs: 0 // Just halted
    };
  }

  /**
   * Resume trading after halt
   */
  @Post('resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume trading after halt',
    description:
      'Re-enables the trading system after an emergency halt. ' +
      'Note: This does NOT automatically resume paused deployments - those must be resumed individually.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trading resumed successfully',
    type: TradingStateResponseDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async resumeTrading(@Body() dto: ResumeTradingDto, @GetUser() user: User): Promise<TradingStateResponseDto> {
    const state = await this.tradingStateService.resumeTrading(user.id, dto);

    return {
      id: state.id,
      tradingEnabled: state.tradingEnabled,
      haltedAt: state.haltedAt,
      haltedBy: state.haltedBy,
      haltReason: state.haltReason,
      resumedAt: state.resumedAt,
      resumedBy: state.resumedBy,
      resumeReason: state.resumeReason,
      haltCount: state.haltCount,
      metadata: state.metadata,
      updatedAt: state.updatedAt
    };
  }

  /**
   * Cancel all pending orders
   */
  @Post('cancel-all-orders')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel all pending orders',
    description:
      'Attempts to cancel all NEW and PARTIALLY_FILLED orders across all users. ' +
      'Returns a summary of successful and failed cancellations. ' +
      'This is a destructive operation - use with extreme caution.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Order cancellation results',
    type: CancelAllOrdersResponseDto
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Requires admin role' })
  async cancelAllOrders(@GetUser() user: User): Promise<CancelAllOrdersResponseDto> {
    return await this.tradingStateService.cancelAllOpenOrders(user.id);
  }
}
