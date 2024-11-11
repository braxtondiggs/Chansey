import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsNumber, IsString, ValidateNested } from 'class-validator';

export class BalanceDto {
  @ApiProperty({
    description: 'Asset symbol',
    example: 'BTC'
  })
  @IsString()
  asset: string;

  @ApiProperty({
    description: 'Available balance',
    example: '0.00000122'
  })
  @IsString()
  free: string;

  @ApiProperty({
    description: 'Locked balance',
    example: '0.00000000'
  })
  @IsString()
  locked: string;
}

export class CommissionRatesDto {
  @ApiProperty({
    description: 'Commission rate for makers',
    example: '0.00400000'
  })
  @IsString()
  maker: string;

  @ApiProperty({
    description: 'Commission rate for takers',
    example: '0.00600000'
  })
  @IsString()
  taker: string;

  @ApiProperty({
    description: 'Commission rate for buyers',
    example: '0.00000000'
  })
  @IsString()
  buyer: string;

  @ApiProperty({
    description: 'Commission rate for sellers',
    example: '0.00000000'
  })
  @IsString()
  seller: string;
}

export class UserBinanceResponseDto {
  @ApiProperty({
    description: 'Commission charged to makers',
    example: 40
  })
  @IsNumber()
  makerCommission: number;

  @ApiProperty({
    description: 'Commission charged to takers',
    example: 60
  })
  @IsNumber()
  takerCommission: number;

  @ApiProperty({
    description: 'Commission charged to buyers',
    example: 0
  })
  @IsNumber()
  buyerCommission: number;

  @ApiProperty({
    description: 'Commission charged to sellers',
    example: 0
  })
  @IsNumber()
  sellerCommission: number;

  @ApiProperty({
    description: 'Nested commission rates',
    type: CommissionRatesDto
  })
  @ValidateNested()
  @Type(() => CommissionRatesDto)
  commissionRates: CommissionRatesDto;

  @ApiProperty({
    description: 'Indicates if trading is allowed',
    example: true
  })
  @IsBoolean()
  canTrade: boolean;

  @ApiProperty({
    description: 'Indicates if withdrawals are allowed',
    example: true
  })
  @IsBoolean()
  canWithdraw: boolean;

  @ApiProperty({
    description: 'Indicates if deposits are allowed',
    example: true
  })
  @IsBoolean()
  canDeposit: boolean;

  @ApiProperty({
    description: 'Indicates if the account is brokered',
    example: false
  })
  @IsBoolean()
  brokered: boolean;

  @ApiProperty({
    description: 'Indicates if self-trade prevention is required',
    example: false
  })
  @IsBoolean()
  requireSelfTradePrevention: boolean;

  @ApiProperty({
    description: 'Timestamp of the last update',
    example: 1705714230214,
    type: Number
  })
  @IsNumber()
  updateTime: number; // Consider transforming to Date if necessary

  @ApiProperty({
    description: 'Type of the account',
    example: 'SPOT'
  })
  @IsString()
  accountType: string;

  @ApiProperty({
    description: 'List of asset balances',
    type: [BalanceDto]
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalanceDto)
  balances: BalanceDto[];

  @ApiProperty({
    description: 'List of permissions',
    example: ['SPOT'],
    type: [String]
  })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];
}
