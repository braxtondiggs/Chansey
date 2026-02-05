import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Algorithm summary for user activity
 */
export class UserAlgorithmSummaryDto {
  @ApiProperty({ description: 'Algorithm activation ID' })
  activationId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'Whether the algorithm is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Total orders from this algorithm' })
  totalOrders: number;

  @ApiPropertyOptional({ description: 'Current ROI', example: 2.5 })
  roi?: number;
}

/**
 * Individual user activity item
 */
export class UserActivityItemDto {
  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'User email' })
  email: string;

  @ApiPropertyOptional({ description: 'User first name' })
  firstName?: string;

  @ApiPropertyOptional({ description: 'User last name' })
  lastName?: string;

  @ApiProperty({ description: 'Total number of algorithm activations' })
  totalActivations: number;

  @ApiProperty({ description: 'Number of currently active algorithms' })
  activeAlgorithms: number;

  @ApiProperty({ description: 'Total algorithmic orders' })
  totalOrders: number;

  @ApiProperty({ description: 'Orders in the last 24 hours' })
  orders24h: number;

  @ApiProperty({ description: 'Orders in the last 7 days' })
  orders7d: number;

  @ApiProperty({ description: 'Total trading volume in USD', example: 50000.5 })
  totalVolume: number;

  @ApiProperty({ description: 'Total realized P&L in USD', example: 1250.75 })
  totalPnL: number;

  @ApiPropertyOptional({ description: 'Average slippage in basis points', example: 12.5 })
  avgSlippageBps?: number;

  @ApiProperty({ description: 'When the user registered' })
  registeredAt: string;

  @ApiProperty({ description: 'When the user last had an algorithmic order' })
  lastOrderAt?: string;

  @ApiProperty({ description: 'Summary of user algorithms', type: [UserAlgorithmSummaryDto] })
  algorithms: UserAlgorithmSummaryDto[];
}

/**
 * Paginated response for user activity
 */
export class PaginatedUserActivityDto {
  @ApiProperty({ description: 'List of user activities', type: [UserActivityItemDto] })
  data: UserActivityItemDto[];

  @ApiProperty({ description: 'Total number of users matching the filter' })
  total: number;

  @ApiProperty({ description: 'Current page number' })
  page: number;

  @ApiProperty({ description: 'Number of items per page' })
  limit: number;

  @ApiProperty({ description: 'Total number of pages' })
  totalPages: number;

  @ApiProperty({ description: 'Whether there is a next page' })
  hasNextPage: boolean;

  @ApiProperty({ description: 'Whether there is a previous page' })
  hasPreviousPage: boolean;
}
