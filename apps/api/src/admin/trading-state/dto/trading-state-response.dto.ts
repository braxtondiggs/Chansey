import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TradingStateResponseDto {
  @ApiProperty({ description: 'Trading state ID' })
  id: string;

  @ApiProperty({ description: 'Whether trading is enabled system-wide' })
  tradingEnabled: boolean;

  @ApiPropertyOptional({ description: 'When trading was last halted' })
  haltedAt: Date | null;

  @ApiPropertyOptional({ description: 'User ID who halted trading' })
  haltedBy: string | null;

  @ApiPropertyOptional({ description: 'Reason for the halt' })
  haltReason: string | null;

  @ApiPropertyOptional({ description: 'When trading was last resumed' })
  resumedAt: Date | null;

  @ApiPropertyOptional({ description: 'User ID who resumed trading' })
  resumedBy: string | null;

  @ApiPropertyOptional({ description: 'Reason/notes for resuming' })
  resumeReason: string | null;

  @ApiProperty({ description: 'Total number of times trading has been halted' })
  haltCount: number;

  @ApiPropertyOptional({ description: 'Additional metadata' })
  metadata: Record<string, unknown> | null;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Duration of current halt in milliseconds (if halted)' })
  haltDurationMs?: number;
}

export class CancelAllOrdersResponseDto {
  @ApiProperty({ description: 'Total orders found to cancel' })
  totalOrders: number;

  @ApiProperty({ description: 'Successfully cancelled orders' })
  successfulCancellations: number;

  @ApiProperty({ description: 'Failed cancellations' })
  failedCancellations: number;

  @ApiProperty({
    description: 'Error details for failed cancellations',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        userId: { type: 'string' },
        error: { type: 'string' }
      }
    }
  })
  errors: Array<{ orderId: string; userId: string; error: string }>;
}
