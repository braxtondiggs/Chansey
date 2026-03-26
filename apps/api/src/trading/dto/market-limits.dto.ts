import { ApiProperty } from '@nestjs/swagger';

export class MarketLimitsDto {
  @ApiProperty({ description: 'Minimum order quantity', example: 0.001 })
  minQuantity: number;

  @ApiProperty({ description: 'Maximum order quantity', example: 9000 })
  maxQuantity: number;

  @ApiProperty({ description: 'Minimum order value in quote currency', example: 10 })
  minCost: number;

  @ApiProperty({ description: 'Quantity step size (precision)', example: 0.00001 })
  quantityStep: number;

  @ApiProperty({ description: 'Price step size (precision)', example: 0.01 })
  priceStep: number;
}
