import { CacheTTL } from '@nestjs/cache-manager';
import {
  BadRequestException,
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Query,
  UseInterceptors
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CoinGeckoClient } from 'coingecko-api-v3';

import { SimplePriceRequestDto, SimplePriceResponseDto } from './dto/simple-price-request.dto';

import { toErrorInfo } from '../shared/error.util';
import { UseCacheKey } from '../utils/decorators/use-cache-key.decorator';
import { CustomCacheInterceptor } from '../utils/interceptors/custom-cache.interceptor';

@ApiTags('Price')
@Controller('simple')
export class SimplePriceController {
  private readonly logger = new Logger(SimplePriceController.name);
  private readonly gecko = new CoinGeckoClient({ timeout: 10000, autoRetry: true });
  private readonly MAX_COINS_PER_REQUEST = 50; // CoinGecko's documented limit

  @Get('price')
  @UseInterceptors(CustomCacheInterceptor)
  @UseCacheKey((ctx) => {
    const request = ctx.switchToHttp().getRequest();
    const query = request.query;
    // Create a cache key based on all query parameters to ensure proper cache differentiation
    const ids = query.ids?.toLowerCase() || '';
    const vs_currencies = query.vs_currencies?.toLowerCase() || 'usd';
    const include_24hr_vol = query.include_24hr_vol === true;
    const include_market_cap = query.include_market_cap === true;
    const include_24hr_change = query.include_24hr_change === true;
    const include_last_updated_at = query.include_last_updated_at === true;
    return `simple-price:${ids}:${vs_currencies}:${include_24hr_vol}:${include_market_cap}:${include_24hr_change}:${include_last_updated_at}`;
  })
  @CacheTTL(60) // Cache for 1 minute (60 seconds)
  @ApiOperation({
    summary: 'Get fresh cryptocurrency prices from CoinGecko',
    description: `
    Retrieves current prices for specified cryptocurrencies directly from CoinGecko.
    Maximum of ${50} coins per request due to API limitations.

    **Coin IDs**: Use CoinGecko coin IDs (slugs) such as 'bitcoin', 'ethereum', 'chainlink', etc.
    **Batch Limits**: Due to CoinGecko API constraints, a maximum of 50 coins can be requested at once.
    **Fresh Data**: This endpoint bypasses any caching and fetches the latest prices directly from CoinGecko.
    `
  })
  @ApiQuery({
    name: 'ids',
    description: 'Comma-separated list of coin IDs (slugs) to get prices for. Maximum 50 coins.',
    example: 'bitcoin,ethereum,chainlink',
    required: true
  })
  @ApiQuery({
    name: 'vs_currencies',
    description: 'Target currency for prices',
    example: 'usd',
    required: false
  })
  @ApiQuery({
    name: 'include_24hr_vol',
    description: 'Include 24hr volume in response',
    example: false,
    required: false,
    type: Boolean
  })
  @ApiQuery({
    name: 'include_market_cap',
    description: 'Include market cap in response',
    example: false,
    required: false,
    type: Boolean
  })
  @ApiQuery({
    name: 'include_24hr_change',
    description: 'Include 24hr change in response',
    example: false,
    required: false,
    type: Boolean
  })
  @ApiQuery({
    name: 'include_last_updated_at',
    description: 'Include last updated timestamp in response',
    example: false,
    required: false,
    type: Boolean
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved prices',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          usd: { type: 'number', example: 45000.12 },
          usd_24h_vol: { type: 'number', example: 35000000000.0 },
          usd_market_cap: { type: 'number', example: 850000000000.0 },
          usd_24h_change: { type: 'number', example: -2.5 },
          last_updated_at: { type: 'number', example: 1714754743 }
        }
      },
      example: {
        bitcoin: {
          usd: 45000.12,
          usd_24h_vol: 35000000000.0,
          usd_market_cap: 850000000000.0,
          usd_24h_change: -2.5,
          last_updated_at: 1714754743
        },
        ethereum: {
          usd: 3200.45,
          usd_24h_vol: 18000000000.0,
          usd_market_cap: 384000000000.0,
          usd_24h_change: 1.8,
          last_updated_at: 1714754743
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request - invalid parameters or too many coins requested'
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error - failed to fetch prices from CoinGecko'
  })
  async getSimplePrice(@Query() query: SimplePriceRequestDto): Promise<SimplePriceResponseDto> {
    try {
      // Parse and validate coin IDs
      const coinIds = query.coinIds;

      if (!coinIds || coinIds.length === 0) {
        throw new BadRequestException('At least one coin ID must be provided');
      }

      if (coinIds.length > this.MAX_COINS_PER_REQUEST) {
        throw new BadRequestException(
          `Too many coins requested. Maximum ${this.MAX_COINS_PER_REQUEST} coins allowed per request. ` +
            `You requested ${coinIds.length} coins.`
        );
      }

      // Remove any empty strings or duplicates
      const uniqueCoinIds = [...new Set(coinIds.filter((id) => id.trim()))];

      if (uniqueCoinIds.length === 0) {
        throw new BadRequestException('No valid coin IDs provided');
      }

      this.logger.log(`Fetching prices for ${uniqueCoinIds.length} coins: ${uniqueCoinIds.join(', ')}`);

      // Call CoinGecko simplePrice API
      const priceData = await this.gecko.simplePrice({
        ids: uniqueCoinIds.join(','),
        vs_currencies: query.vs_currencies || 'usd',
        include_24hr_vol: query.include_24hr_vol || false,
        include_market_cap: query.include_market_cap || false,
        include_24hr_change: query.include_24hr_change || false,
        include_last_updated_at: query.include_last_updated_at || false
      });

      // Log successful response
      const returnedCoins = Object.keys(priceData).length;
      this.logger.log(`Successfully fetched prices for ${returnedCoins} of ${uniqueCoinIds.length} requested coins`);

      // Warn about missing coins
      const missingCoins = uniqueCoinIds.filter((id) => !priceData[id]);
      if (missingCoins.length > 0) {
        this.logger.warn(`No price data found for the following coins: ${missingCoins.join(', ')}`);
      }

      return priceData;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Failed to fetch prices: ${err.message}`, err.stack);

      // Re-throw validation errors as-is
      if (error instanceof BadRequestException) {
        throw error;
      }

      // Handle CoinGecko API errors
      const errObj = error as any;
      if (errObj?.response?.status === 429) {
        throw new InternalServerErrorException(
          'Rate limit exceeded. Please wait a moment before making another request.'
        );
      }

      if (errObj?.response?.status >= 400 && errObj?.response?.status < 500) {
        throw new BadRequestException(`Invalid request to CoinGecko API: ${err.message}`);
      }

      // General error fallback
      throw new InternalServerErrorException('Failed to fetch cryptocurrency prices. Please try again later.');
    }
  }
}
