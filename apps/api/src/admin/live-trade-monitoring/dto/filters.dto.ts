import { ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * Sort order enum
 */
export enum SortOrder {
  ASC = 'ASC',
  DESC = 'DESC'
}

/**
 * Base query filters for live trade monitoring endpoints
 */
export class LiveTradeFiltersDto {
  @ApiPropertyOptional({ description: 'Start date for filtering (ISO string)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date for filtering (ISO string)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Filter by algorithm ID' })
  @IsOptional()
  @IsUUID()
  algorithmId?: string;

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}

/**
 * Sortable fields for algorithms
 */
export enum AlgorithmSortField {
  NAME = 'name',
  ACTIVATED_AT = 'activatedAt',
  TOTAL_ORDERS = 'totalOrders',
  ROI = 'roi',
  WIN_RATE = 'winRate'
}

/**
 * Query parameters for paginated algorithm list
 */
export class AlgorithmListQueryDto extends LiveTradeFiltersDto {
  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Field to sort by', enum: AlgorithmSortField })
  @IsOptional()
  @IsEnum(AlgorithmSortField)
  sortBy?: AlgorithmSortField = AlgorithmSortField.ACTIVATED_AT;

  @ApiPropertyOptional({ description: 'Sort order', enum: SortOrder })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({ description: 'Search by algorithm name (partial match)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by active status' })
  @IsOptional()
  @Type(() => Boolean)
  isActive?: boolean;
}

/**
 * Sortable fields for orders
 */
export enum OrderSortField {
  CREATED_AT = 'createdAt',
  TRANSACT_TIME = 'transactTime',
  SYMBOL = 'symbol',
  COST = 'cost',
  ACTUAL_SLIPPAGE_BPS = 'actualSlippageBps'
}

/**
 * Query parameters for paginated order list
 */
export class OrderListQueryDto extends LiveTradeFiltersDto {
  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Field to sort by', enum: OrderSortField })
  @IsOptional()
  @IsEnum(OrderSortField)
  sortBy?: OrderSortField = OrderSortField.CREATED_AT;

  @ApiPropertyOptional({ description: 'Sort order', enum: SortOrder })
  @IsOptional()
  @IsEnum(SortOrder)
  sortOrder?: SortOrder = SortOrder.DESC;

  @ApiPropertyOptional({ description: 'Filter by algorithm activation ID' })
  @IsOptional()
  @IsUUID()
  algorithmActivationId?: string;

  @ApiPropertyOptional({ description: 'Filter by symbol (e.g., BTC/USDT)' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  symbol?: string;
}

/**
 * Query parameters for user activity list
 */
export class UserActivityQueryDto {
  @ApiPropertyOptional({ description: 'Page number (1-indexed)', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Number of items per page', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Filter users with minimum active algorithms' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minActiveAlgorithms?: number;

  @ApiPropertyOptional({ description: 'Search by user email (partial match)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

/**
 * Export format options
 */
export enum ExportFormat {
  CSV = 'csv',
  JSON = 'json'
}
