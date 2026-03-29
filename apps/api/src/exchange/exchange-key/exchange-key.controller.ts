import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
  Post,
  UseGuards,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import {
  CreateExchangeKeyDto,
  ExchangeKeyHealthHistoryResponseDto,
  ExchangeKeyHealthSummaryDto,
  ExchangeKeyResponseDto,
  HealthHistoryQueryDto
} from './dto';
import { ExchangeKeyHealthService } from './exchange-key-health.service';
import { ExchangeKey } from './exchange-key.entity';
import { ExchangeKeyService } from './exchange-key.service';

import GetUser from '../../authentication/decorator/get-user.decorator';
import { JwtAuthenticationGuard } from '../../authentication/guard/jwt-authentication.guard';
import { User } from '../../users/users.entity';

@ApiTags('Exchange Keys')
@Controller('exchange-keys')
@UseGuards(JwtAuthenticationGuard)
@ApiBearerAuth('token')
@UseInterceptors(ClassSerializerInterceptor)
export class ExchangeKeyController {
  constructor(
    private readonly exchangeKeyService: ExchangeKeyService,
    private readonly exchangeKeyHealthService: ExchangeKeyHealthService
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new exchange key (only one set of keys per exchange is allowed)' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The exchange key has been successfully created.',
    type: ExchangeKeyResponseDto
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'An exchange key already exists for this exchange. Remove the existing key before adding a new one.'
  })
  async create(
    @GetUser() user: User,
    @Body() createExchangeKeyDto: CreateExchangeKeyDto
  ): Promise<ExchangeKeyResponseDto> {
    const exchangeKey = await this.exchangeKeyService.create(user.id, createExchangeKeyDto);
    return this.transformToResponse(exchangeKey);
  }

  @Get()
  @ApiOperation({ summary: 'Get all exchange keys for the current user' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns all exchange keys for the current user',
    type: [ExchangeKeyResponseDto]
  })
  async findAll(@GetUser() user: User): Promise<ExchangeKeyResponseDto[]> {
    const keys = await this.exchangeKeyService.findAll(user.id);
    return keys.map((key) => this.transformToResponse(key));
  }

  @Throttle({ default: { limit: 2, ttl: 60000 } })
  @Post(':id/recheck')
  @ApiOperation({ summary: 'Recheck health of an exchange key (reactivates if deactivated by health check)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns updated health status after recheck',
    type: ExchangeKeyHealthSummaryDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange key not found'
  })
  async recheckKey(
    @GetUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string
  ): Promise<ExchangeKeyHealthSummaryDto> {
    return this.exchangeKeyHealthService.recheckKey(id, user.id);
  }

  @Get('health')
  @ApiOperation({ summary: 'Get health status summary for all exchange keys' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns health status for all user exchange keys',
    type: [ExchangeKeyHealthSummaryDto]
  })
  async getHealthSummary(@GetUser() user: User): Promise<ExchangeKeyHealthSummaryDto[]> {
    return this.exchangeKeyHealthService.getHealthSummary(user.id);
  }

  @Get(':id/health/history')
  @ApiOperation({ summary: 'Get health check history for an exchange key' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (default: 20)' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns paginated health check history',
    type: ExchangeKeyHealthHistoryResponseDto
  })
  async getHealthHistory(
    @GetUser() user: User,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: HealthHistoryQueryDto
  ): Promise<ExchangeKeyHealthHistoryResponseDto> {
    return this.exchangeKeyHealthService.getHealthHistory(id, user.id, query.page ?? 1, query.limit ?? 20);
  }

  @Get('exchange/:exchangeId')
  @ApiOperation({ summary: 'Get the exchange key for a specific exchange' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the exchange key for the specified exchange',
    type: ExchangeKeyResponseDto
  })
  async findByExchange(
    @GetUser() user: User,
    @Param('exchangeId') exchangeId: string
  ): Promise<ExchangeKeyResponseDto[]> {
    // This endpoint still returns an array for backward compatibility
    // but will only ever contain a single key
    const keys = await this.exchangeKeyService.findByExchange(exchangeId, user.id);
    return keys.map((key) => this.transformToResponse(key));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single exchange key by ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns the exchange key with the specified ID',
    type: ExchangeKeyResponseDto
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange key not found'
  })
  async findOne(@GetUser() user: User, @Param('id', new ParseUUIDPipe()) id: string): Promise<ExchangeKeyResponseDto> {
    const key = await this.exchangeKeyService.findOne(id, user.id);
    return this.transformToResponse(key);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an exchange key' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'The exchange key has been successfully deleted'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Exchange key not found'
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@GetUser() user: User, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.exchangeKeyService.remove(id, user.id);
  }

  private transformToResponse(exchangeKey: ExchangeKey): ExchangeKeyResponseDto {
    const response = new ExchangeKeyResponseDto();
    response.id = exchangeKey.id;
    response.userId = exchangeKey.userId;
    response.exchangeId = exchangeKey.exchangeId;
    response.isActive = exchangeKey.isActive;
    response.createdAt = exchangeKey.createdAt;
    response.updatedAt = exchangeKey.updatedAt;
    response.hasApiKey = !!exchangeKey.apiKey;
    response.hasSecretKey = !!exchangeKey.secretKey;

    response.healthStatus = exchangeKey.healthStatus ?? 'unknown';
    response.lastHealthCheckAt = exchangeKey.lastHealthCheckAt ?? null;
    response.consecutiveFailures = exchangeKey.consecutiveFailures ?? 0;
    response.lastErrorCategory = exchangeKey.lastErrorCategory ?? null;
    response.lastErrorMessage = exchangeKey.lastErrorMessage ?? null;
    response.deactivatedByHealthCheck = exchangeKey.deactivatedByHealthCheck ?? false;

    if (exchangeKey.exchange) {
      response.exchange = {
        id: exchangeKey.exchange.id,
        name: exchangeKey.exchange.name,
        slug: exchangeKey.exchange.slug
      };
    }

    return response;
  }
}
