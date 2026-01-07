import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { OrderTransitionReason } from '../entities/order-status-history.entity';
import { OrderStatus } from '../order.entity';

/**
 * Response DTO for order status history entries
 */
export class OrderStatusHistoryDto {
  @ApiProperty({
    description: 'Unique identifier for the history record',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Order ID this history belongs to',
    example: 'b4cc290f-9cf0-4999-0023-bdf5f7654113'
  })
  orderId: string;

  @ApiPropertyOptional({
    description: 'Previous status (null for initial creation)',
    enum: OrderStatus,
    example: OrderStatus.NEW,
    nullable: true
  })
  fromStatus: OrderStatus | null;

  @ApiProperty({
    description: 'New status after transition',
    enum: OrderStatus,
    example: OrderStatus.FILLED
  })
  toStatus: OrderStatus;

  @ApiProperty({
    description: 'When the transition occurred',
    example: '2024-04-23T18:25:43.511Z'
  })
  transitionedAt: Date;

  @ApiProperty({
    description: 'Reason for the status change',
    enum: OrderTransitionReason,
    example: OrderTransitionReason.EXCHANGE_SYNC
  })
  reason: OrderTransitionReason;

  @ApiPropertyOptional({
    description: 'Additional context for the transition',
    example: { exchangeOrderId: '123456789', syncTimestamp: '2024-04-23T18:25:43.511Z' },
    nullable: true
  })
  metadata?: Record<string, unknown> | null;
}

/**
 * Response DTO for order history with summary statistics
 */
export class OrderHistoryResponseDto {
  @ApiProperty({
    description: 'The order ID',
    example: 'b4cc290f-9cf0-4999-0023-bdf5f7654113'
  })
  orderId: string;

  @ApiProperty({
    description: 'Current order status',
    enum: OrderStatus,
    example: OrderStatus.FILLED
  })
  currentStatus: OrderStatus;

  @ApiProperty({
    description: 'Total number of status transitions',
    example: 3
  })
  transitionCount: number;

  @ApiProperty({
    description: 'List of status transitions in chronological order',
    type: [OrderStatusHistoryDto]
  })
  transitions: OrderStatusHistoryDto[];
}
