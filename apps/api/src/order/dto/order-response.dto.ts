import { ApiProperty } from '@nestjs/swagger';

import { OrderDto } from './order.dto';

import { CoinResponseDto } from '../../coin/dto/coin-response.dto';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { OrderSide, OrderStatus, OrderType } from '../order.entity';

export class OrderResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the order',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Symbol of the coin related to the order',
    example: 'BTC'
  })
  symbol: string;

  @ApiProperty({
    description: 'Unique order ID',
    example: '123456789012345678',
    type: String
  })
  orderId: string;

  @ApiProperty({
    description: 'Client-specified order ID',
    example: 'client-12345'
  })
  clientOrderId: string;

  @ApiProperty({
    description: 'Transaction time in milliseconds since epoch',
    example: '1622547800000',
    type: String
  })
  transactTime: string;

  @ApiProperty({
    description: 'Quantity of the order',
    example: 0.5
  })
  quantity: number;

  @ApiProperty({
    description: 'Current status of the order',
    enum: OrderStatus,
    example: OrderStatus.NEW
  })
  status: OrderStatus;

  @ApiProperty({
    description: 'Side of the order',
    enum: OrderSide,
    example: OrderSide.BUY
  })
  side: OrderSide;

  @ApiProperty({
    description: 'Type of the order',
    enum: OrderType,
    example: OrderType.LIMIT
  })
  type: OrderType;

  @ApiProperty({
    description: 'User who placed the order',
    type: () => UserResponseDto
  })
  user: UserResponseDto;

  @ApiProperty({
    description: 'Base coin of the trading pair',
    type: () => CoinResponseDto
  })
  baseCoin: CoinResponseDto;

  @ApiProperty({
    description: 'Quote coin of the trading pair',
    type: () => CoinResponseDto
  })
  quoteCoin: CoinResponseDto;

  @ApiProperty({
    description: 'Timestamp when the order was created',
    example: '2024-04-23T18:25:43.511Z'
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the order was last updated',
    example: '2024-04-23T18:25:43.511Z'
  })
  updatedAt: Date;

  @ApiProperty({
    description: 'Price at which the order was executed',
    example: 35000.5,
    required: false
  })
  price?: number;

  @ApiProperty({
    description: 'Executed quantity of the order',
    example: 0.3,
    required: false
  })
  executedQuantity?: number;

  @ApiProperty({
    description: 'Total cost of the order',
    example: 10500.15,
    required: false
  })
  cost?: number;

  @ApiProperty({
    description: 'Trading fee amount',
    example: 5.25,
    required: false
  })
  fee?: number;

  @ApiProperty({
    description: 'Commission amount',
    example: 5.25,
    required: false
  })
  commission?: number;

  @ApiProperty({
    description: 'Currency code for the trading fee',
    example: 'USDT',
    required: false
  })
  feeCurrency?: string;

  @ApiProperty({
    description: 'Gain or loss for the order',
    example: 125.5,
    required: false
  })
  gainLoss?: number;

  @ApiProperty({
    description: 'Average execution price for partially filled orders',
    example: 35125.75,
    required: false
  })
  averagePrice?: number;

  // New algorithmic trading fields
  @ApiProperty({
    description: 'Time in force for the order (GTC, IOC, FOK)',
    example: 'GTC',
    required: false
  })
  timeInForce?: string;

  @ApiProperty({
    description: 'Stop price for stop orders',
    example: 34000.0,
    required: false
  })
  stopPrice?: number;

  @ApiProperty({
    description: 'Trigger price for conditional orders',
    example: 34500.0,
    required: false
  })
  triggerPrice?: number;

  @ApiProperty({
    description: 'Take profit price level',
    example: 36000.0,
    required: false
  })
  takeProfitPrice?: number;

  @ApiProperty({
    description: 'Stop loss price level',
    example: 33000.0,
    required: false
  })
  stopLossPrice?: number;

  @ApiProperty({
    description: 'Remaining unfilled quantity',
    example: 0.2,
    required: false
  })
  remaining?: number;

  @ApiProperty({
    description: 'Whether the order is post-only (maker-only)',
    example: false,
    required: false
  })
  postOnly?: boolean;

  @ApiProperty({
    description: 'Whether the order is reduce-only (position management)',
    example: false,
    required: false
  })
  reduceOnly?: boolean;

  @ApiProperty({
    description: 'Timestamp of the last trade execution',
    example: '2024-04-23T18:30:43.511Z',
    required: false,
    type: Date
  })
  lastTradeTimestamp?: Date;

  @ApiProperty({
    description: 'Timestamp when the order was last updated',
    example: '2024-04-23T18:25:43.511Z',
    required: false,
    type: Date
  })
  lastUpdateTimestamp?: Date;

  @ApiProperty({
    description: 'Individual trade executions data',
    example: [
      {
        id: 'trade123',
        timestamp: 1640995200000,
        price: 35000.5,
        amount: 0.1,
        cost: 3500.05,
        side: 'buy',
        fee: { cost: 1.75, currency: 'USDT' },
        takerOrMaker: 'taker'
      }
    ],
    required: false,
    type: Object,
    isArray: true
  })
  trades?: Record<string, unknown>[];

  @ApiProperty({
    description: 'Raw exchange-specific order information',
    example: {
      orderListId: -1,
      contingencyType: 'OCO',
      listStatusType: 'EXEC_STARTED',
      listOrderStatus: 'EXECUTING',
      listClientOrderId: 'C3wyj4WVEktd7u9aVBRXcN',
      transactionTime: 1565245913483,
      workingTime: 1565245913483
    },
    required: false,
    type: Object
  })
  info?: Record<string, unknown>;

  constructor(order: Partial<OrderDto>) {
    Object.assign(this, order);
  }
}
