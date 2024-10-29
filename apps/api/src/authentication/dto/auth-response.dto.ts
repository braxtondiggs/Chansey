import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class UserDto {
  @ApiProperty({
    description: 'User ID',
    example: '48d3b373-6b9d-4347-bf85-5712afe1d68f'
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'User email',
    example: 'braxtondiggs@gmail.com'
  })
  @Expose()
  email: string;

  @ApiProperty({
    description: 'Whether the email is verified',
    example: true
  })
  @Expose()
  email_verified: boolean;

  @ApiProperty({
    description: 'Given name (first name)',
    example: 'Braxton',
    nullable: true
  })
  @Expose()
  given_name: string | null;

  @ApiProperty({
    description: 'Family name (last name)',
    example: 'Diggs',
    nullable: true
  })
  @Expose()
  family_name: string | null;

  @ApiProperty({
    description: 'Middle name',
    example: null,
    nullable: true
  })
  @Expose()
  middle_name: string | null;

  @ApiProperty({
    description: 'Nickname',
    example: null,
    nullable: true
  })
  @Expose()
  nickname: string | null;

  @ApiProperty({
    description: 'Preferred username',
    example: 'braxtondiggs@gmail.com',
    nullable: true
  })
  @Expose()
  preferred_username: string | null;

  @ApiProperty({
    description: 'Profile picture URL',
    example: null,
    nullable: true
  })
  @Expose()
  picture: string | null;

  @ApiProperty({
    description: 'Signup methods used',
    example: 'basic_auth'
  })
  @Expose()
  signup_methods: string;

  @ApiProperty({
    description: 'Gender',
    example: 'Male',
    nullable: true
  })
  @Expose()
  gender: string | null;

  @ApiProperty({
    description: 'Birthdate',
    example: null,
    nullable: true
  })
  @Expose()
  birthdate: string | null;

  @ApiProperty({
    description: 'Phone number',
    example: null,
    nullable: true
  })
  @Expose()
  phone_number: string | null;

  @ApiProperty({
    description: 'Whether the phone number is verified',
    example: false
  })
  @Expose()
  phone_number_verified: boolean;

  @ApiProperty({
    description: 'Roles assigned to the user',
    example: ['admin'],
    isArray: true,
    type: String
  })
  @Expose()
  roles: string[];

  @ApiProperty({
    description: 'Account creation timestamp (Unix epoch)',
    example: 1688761193
  })
  @Expose()
  created_at: number;

  @ApiProperty({
    description: 'Account last updated timestamp (Unix epoch)',
    example: 1688762890
  })
  @Expose()
  updated_at: number;

  @ApiProperty({
    description: 'Whether multi-factor authentication is enabled',
    example: null,
    nullable: true
  })
  @Expose()
  is_multi_factor_auth_enabled: boolean | null;

  @ApiProperty({
    description: 'Application-specific data',
    example: {},
    type: Object
  })
  @Expose()
  app_data: Record<string, any>;

  constructor(partial: Partial<UserDto>) {
    Object.assign(this, partial);
  }
}
