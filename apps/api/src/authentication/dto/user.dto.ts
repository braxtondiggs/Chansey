import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';

import { ExchangeKey, IUser, Role } from '@chansey/api-interfaces';

export class UserDto implements IUser {
  @ApiProperty({
    description: 'User ID',
    example: '48d3b373-6b9d-4347-bf85-5712afe1d68f'
  })
  @Expose()
  id = '';

  @ApiProperty({
    description: 'User email',
    example: 'braxtondiggs@gmail.com'
  })
  @Expose()
  email = '';

  @ApiProperty({
    description: 'Whether the email is verified',
    example: true
  })
  @Expose()
  emailVerified = false;

  @ApiProperty({
    description: 'Given name (first name)',
    example: 'Braxton',
    nullable: true
  })
  @Expose()
  given_name: string | null = null;

  @ApiProperty({
    description: 'Family name (last name)',
    example: 'Diggs',
    nullable: true
  })
  @Expose()
  family_name: string | null = null;

  @ApiProperty({
    description: 'Middle name',
    example: null,
    nullable: true
  })
  @Expose()
  middle_name: string | null = null;

  @ApiProperty({
    description: 'Nickname',
    example: null,
    nullable: true
  })
  @Expose()
  nickname: string | null = null;

  @ApiProperty({
    description: 'Profile picture URL',
    example: null,
    nullable: true
  })
  @Expose()
  picture: string | null = null;

  @ApiProperty({
    description: 'Gender',
    example: 'Male',
    nullable: true
  })
  @Expose()
  gender: string | null = null;

  @ApiProperty({
    description: 'Birthdate',
    example: null,
    nullable: true
  })
  @Expose()
  birthdate: string | null = null;

  @ApiProperty({
    description: 'Phone number',
    example: null,
    nullable: true
  })
  @Expose()
  phone_number: string | null = null;

  @ApiProperty({
    description: 'Roles assigned to the user',
    example: [Role.ADMIN],
    isArray: true,
    enum: Role
  })
  @Expose()
  roles: Role[] = [];

  @ApiProperty({
    description: 'Whether OTP/2FA is enabled',
    example: false
  })
  @Expose()
  otpEnabled = false;

  @ApiProperty({
    description: 'Last login timestamp',
    example: '2024-01-15T12:00:00.000Z',
    nullable: true
  })
  @Expose()
  lastLoginAt: Date | null = null;

  @ApiProperty({
    description: 'Exchanges associated with the user',
    example: [],
    type: Array
  })
  @Expose()
  exchanges: ExchangeKey[] = [];

  @ApiProperty({
    description: 'Whether to hide portfolio balance',
    example: false,
    required: false
  })
  @Expose()
  hide_balance?: boolean;

  @ApiProperty({
    description: 'Whether algorithmic trading is enabled',
    example: false,
    required: false
  })
  @Expose()
  algoTradingEnabled?: boolean;

  @ApiProperty({
    description: 'Percentage of capital allocated to algo trading',
    example: 50,
    required: false
  })
  @Expose()
  algoCapitalAllocationPercentage?: number;

  @ApiProperty({
    description: 'When user enrolled in algo trading',
    example: '2024-01-15T12:00:00.000Z',
    required: false
  })
  @Expose()
  algoEnrolledAt?: Date;

  constructor(partial: Partial<UserDto>) {
    Object.assign(this, partial);
  }
}
