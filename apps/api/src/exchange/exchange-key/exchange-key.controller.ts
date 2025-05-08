import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  HttpStatus,
  ClassSerializerInterceptor,
  UseInterceptors
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CreateExchangeKeyDto, ExchangeKeyResponseDto, UpdateExchangeKeyDto } from './dto';
import { ExchangeKey } from './exchange-key.entity';
import { ExchangeKeyService } from './exchange-key.service';

import GetUser from '../../authentication/decorator/get-user.decorator';
import JwtAuthenticationGuard from '../../authentication/guard/jwt-authentication.guard';
import { User } from '../../users/users.entity';

@ApiTags('Exchange Keys')
@Controller('exchange-keys')
@UseGuards(JwtAuthenticationGuard)
@ApiBearerAuth()
@UseInterceptors(ClassSerializerInterceptor)
export class ExchangeKeyController {
  constructor(private readonly exchangeKeyService: ExchangeKeyService) {}

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
  async findOne(@GetUser() user: User, @Param('id') id: string): Promise<ExchangeKeyResponseDto> {
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
  async remove(@GetUser() user: User, @Param('id') id: string): Promise<ExchangeKey> {
    return await this.exchangeKeyService.remove(id, user.id);
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
