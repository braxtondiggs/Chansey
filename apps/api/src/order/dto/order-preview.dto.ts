import { ApiProperty } from '@nestjs/swagger';

import { OrderSide, OrderType, TrailingType } from '../order.entity';

export class OrderPreviewDto {
  @ApiProperty({
    description: 'The trading symbol for the order',
    example: 'BTC/USDT'
  })
  symbol: string;

  @ApiProperty({
    description: 'Order side - BUY or SELL',
    enum: OrderSide,
    example: OrderSide.BUY
  })
  side: OrderSide;

  @ApiProperty({
    description: 'Order type',
    enum: OrderType,
    example: OrderType.MARKET
  })
  orderType: OrderType;

  @ApiProperty({
    description: 'Quantity to buy/sell',
    example: 0.1
  })
  quantity: number;

  @ApiProperty({
    description: 'Price per unit (for limit orders or estimated for market orders)',
    example: 50000.0,
    required: false
  })
  price?: number;

  @ApiProperty({
    description: 'Stop price for stop orders',
    example: 48000.0,
    required: false
  })
  stopPrice?: number;

  @ApiProperty({
    description: 'Trailing amount for trailing stop orders',
    example: 100.0,
    required: false
  })
  trailingAmount?: number;

  @ApiProperty({
    description: 'Trailing type - amount or percentage',
    enum: TrailingType,
    required: false
  })
  trailingType?: TrailingType;

  @ApiProperty({
    description: 'Estimated cost of the order',
    example: 5000.0
  })
  estimatedCost: number;

  @ApiProperty({
    description: 'Estimated trading fee',
    example: 5.0
  })
  estimatedFee: number;

  @ApiProperty({
    description: 'Fee rate as decimal (e.g., 0.001 for 0.1%)',
    example: 0.001
  })
  feeRate: number;

  @ApiProperty({
    description: 'Fee currency symbol',
    example: 'USDT'
  })
  feeCurrency: string;

  @ApiProperty({
    description: 'Total required (cost + fees for BUY, cost for SELL)',
    example: 5005.0
  })
  totalRequired: number;

  @ApiProperty({
    description: 'Current market price for reference',
    example: 50000.0,
    required: false
  })
  marketPrice?: number;

  @ApiProperty({
    description: 'Available balance for the transaction',
    example: 10000.0
  })
  availableBalance: number;

  @ApiProperty({
    description: 'Currency of the available balance',
    example: 'USDT'
  })
  balanceCurrency: string;

  @ApiProperty({
    description: 'Whether the user has sufficient balance',
    example: true
  })
  hasSufficientBalance: boolean;

  @ApiProperty({
    description: 'Price deviation from market price (percentage)',
    example: 5.2,
    required: false
  })
  priceDeviation?: number;

  @ApiProperty({
    description: 'Estimated slippage for market orders (percentage)',
    example: 0.05,
    required: false
  })
  estimatedSlippage?: number;

  @ApiProperty({
    description: 'Warning messages about the order',
    type: [String],
    example: ['Price is 5% above market price'],
    default: []
  })
  warnings: string[];

  @ApiProperty({
    description: 'Exchange where the order will be executed',
    example: 'binance_us'
  })
  exchange: string;

  @ApiProperty({
    description: 'Order types supported by this exchange',
    type: [String],
    enum: OrderType,
    example: [OrderType.MARKET, OrderType.LIMIT],
    required: false
  })
  supportedOrderTypes?: OrderType[];
}
