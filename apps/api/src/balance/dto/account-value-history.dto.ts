import { ApiProperty } from '@nestjs/swagger';

export class AccountValueDataPoint {
  @ApiProperty({
    description: 'The date and time in ISO format',
    example: '2025-05-01T14:00:00Z'
  })
  datetime: string;

  @ApiProperty({
    description: 'Total account value in USD at this time',
    example: 24567.89
  })
  value: number;
}

export class AccountValueHistoryDto {
  @ApiProperty({
    description: 'Array of account value data points over time',
    type: [AccountValueDataPoint]
  })
  history: AccountValueDataPoint[];

  @ApiProperty({
    description: 'Current total account value in USD',
    example: 26789.01
  })
  currentValue: number;

  @ApiProperty({
    description: 'Change in account value over the period (as percentage)',
    example: 12.5
  })
  changePercentage: number;
}
