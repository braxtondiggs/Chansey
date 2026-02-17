import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

import { OpportunitySellingUserConfig } from '../../order/interfaces/opportunity-selling.interface';

/**
 * DTO for updating opportunity selling configuration.
 * All fields are optional — only provided fields are merged into the existing config.
 */
export class UpdateOpportunitySellingConfigDto {
  @ApiPropertyOptional({
    description: 'Enable or disable opportunity selling',
    example: true
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Minimum buy signal confidence to trigger opportunity selling (0-1)',
    example: 0.7,
    minimum: 0,
    maximum: 1
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minOpportunityConfidence?: number;

  @ApiPropertyOptional({
    description: 'Minimum hours a position must be held before eligible for selling',
    example: 48,
    minimum: 0
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minHoldingPeriodHours?: number;

  @ApiPropertyOptional({
    description: 'Positions with unrealized gains above this % are protected from selling',
    example: 15,
    minimum: 0,
    maximum: 100
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  protectGainsAbovePercent?: number;

  @ApiPropertyOptional({
    description: 'Coin IDs that are never eligible for opportunity selling',
    example: ['bitcoin', 'ethereum'],
    type: [String]
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Type(() => String)
  protectedCoins?: string[];

  @ApiPropertyOptional({
    description: 'Minimum advantage (%) the new opportunity must have over existing positions',
    example: 10,
    minimum: 0
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minOpportunityAdvantagePercent?: number;

  @ApiPropertyOptional({
    description: 'Maximum percentage of portfolio that can be liquidated in a single evaluation',
    example: 30,
    minimum: 1,
    maximum: 100
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  maxLiquidationPercent?: number;

  @ApiPropertyOptional({
    description: 'Use algorithm performance ranking to weight position protection scores',
    example: true
  })
  @IsOptional()
  @IsBoolean()
  useAlgorithmRanking?: boolean;
}

/**
 * Response DTO for opportunity selling status
 */
export class OpportunitySellingStatusDto {
  @ApiProperty({
    description: 'Whether opportunity selling is enabled',
    example: true
  })
  enabled: boolean;

  @ApiProperty({
    description: 'Current opportunity selling configuration'
  })
  config: OpportunitySellingUserConfig;
}
