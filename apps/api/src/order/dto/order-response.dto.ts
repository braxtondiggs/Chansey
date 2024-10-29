import { ApiProperty } from '@nestjs/swagger';

import { CoinResponseDto } from '../../coin/dto/coin-response.dto';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { Order, OrderSide, OrderStatus, OrderType } from '../order.entity';

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
    description: 'Coin associated with the order',
    type: () => CoinResponseDto
  })
  coin: CoinResponseDto;

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

  constructor(order: Order) {
    this.id = order.id;
    this.symbol = order.symbol;
    this.orderId = order.orderId;
    this.clientOrderId = order.clientOrderId;
    this.transactTime = order.transactTime;
    this.quantity = order.quantity;
    this.status = order.status;
    this.side = order.side;
    this.type = order.type;
    this.user = new UserResponseDto(order.user);
    this.coin = new CoinResponseDto(order.coin);
    this.createdAt = order.createdAt;
    this.updatedAt = order.updatedAt;
  }
}
