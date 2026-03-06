import { ApiProperty } from '@nestjs/swagger';

import { IsNumber, IsPositive, Max, Min } from 'class-validator';

/**
 * DTO for enabling algo trading (robo-advisor).
 * User opts in by allocating a percentage of their free balance to automated strategies.
 */
export class EnrollInAlgoTradingDto {
  @ApiProperty({
    description: 'Percentage of free balance to allocate to algorithmic trading (e.g., 25 = 25%)',
    example: 25,
    minimum: 5,
    maximum: 100
  })
  @IsNumber()
  @IsPositive()
  @Min(5, { message: 'Minimum capital allocation is 5% of your free balance' })
  @Max(100, { message: 'Maximum capital allocation is 100% of your free balance' })
  capitalAllocationPercentage: number;
}

/**
 * DTO for updating capital allocation percentage.
 * Allows user to increase/decrease allocation percentage while algo trading is active.
 */
export class UpdateAlgoCapitalDto {
  @ApiProperty({
    description: 'New capital allocation percentage (e.g., 35 = 35%)',
    example: 35,
    minimum: 5,
    maximum: 100
  })
  @IsNumber()
  @IsPositive()
  @Min(5, { message: 'Minimum capital allocation is 5% of your free balance' })
  @Max(100, { message: 'Maximum capital allocation is 100% of your free balance' })
  newPercentage: number;
}

/**
 * Response DTO for algo trading status.
 * Shows current enrollment state and allocation percentage.
 */
export class AlgoTradingStatusDto {
  @ApiProperty({
    description: 'Whether algo trading is currently enabled',
    example: true
  })
  enabled: boolean;

  @ApiProperty({
    description: 'Percentage of free balance allocated to algo trading',
    example: 25,
    nullable: true
  })
  capitalAllocationPercentage: number | null;

  @ApiProperty({
    description: 'When user enrolled in algo trading',
    example: '2025-11-18T10:00:00Z',
    nullable: true
  })
  enrolledAt: Date | null;

  @ApiProperty({
    description: 'User risk level (determines strategy assignment)',
    example: 'Moderate'
  })
  riskLevel: string;

  @ApiProperty({
    description: 'Number of active strategies for user risk level',
    example: 25
  })
  activeStrategies: number;
}
