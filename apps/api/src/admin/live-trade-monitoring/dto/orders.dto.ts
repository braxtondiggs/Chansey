import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OrderSide, OrderStatus, OrderType } from '../../../order/order.entity';

/**
 * Individual algorithmic order item in the list
 */
export class AlgorithmicOrderListItemDto {
  @ApiProperty({ description: 'Order ID' })
  id: string;

  @ApiProperty({ description: 'Trading pair symbol', example: 'BTC/USDT' })
  symbol: string;

  @ApiProperty({ description: 'Exchange-specific order ID' })
  orderId: string;

  @ApiProperty({ description: 'Order side', enum: OrderSide })
  side: OrderSide;

  @ApiProperty({ description: 'Order type', enum: OrderType })
  type: OrderType;

  @ApiProperty({ description: 'Order status', enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ description: 'Order quantity' })
  quantity: number;

  @ApiProperty({ description: 'Order price' })
  price: number;

  @ApiProperty({ description: 'Executed quantity' })
  executedQuantity: number;

  @ApiPropertyOptional({ description: 'Total cost of the order' })
  cost?: number;

  @ApiPropertyOptional({ description: 'Average execution price' })
  averagePrice?: number;

  @ApiPropertyOptional({ description: 'Expected price before execution' })
  expectedPrice?: number;

  @ApiPropertyOptional({ description: 'Actual slippage in basis points' })
  actualSlippageBps?: number;

  @ApiProperty({ description: 'Fee paid' })
  fee: number;

  @ApiPropertyOptional({ description: 'Gain or loss on the order' })
  gainLoss?: number;

  @ApiProperty({ description: 'Algorithm activation ID' })
  algorithmActivationId: string;

  @ApiProperty({ description: 'Algorithm name' })
  algorithmName: string;

  @ApiProperty({ description: 'User ID' })
  userId: string;

  @ApiProperty({ description: 'User email' })
  userEmail: string;

  @ApiProperty({ description: 'Exchange name' })
  exchangeName: string;

  @ApiProperty({ description: 'Transaction time' })
  transactTime: string;

  @ApiProperty({ description: 'Order creation timestamp' })
  createdAt: string;
}

/**
 * Paginated response for algorithmic orders
 */
export class PaginatedOrderListDto {
  @ApiProperty({ description: 'List of algorithmic orders', type: [AlgorithmicOrderListItemDto] })
  data: AlgorithmicOrderListItemDto[];

  @ApiProperty({ description: 'Total number of items matching the filter' })
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

  @ApiProperty({ description: 'Total volume across all filtered orders' })
  totalVolume: number;

  @ApiProperty({ description: 'Total P&L across all filtered orders' })
  totalPnL: number;

  @ApiProperty({ description: 'Average slippage across all filtered orders' })
  avgSlippageBps: number;
}
