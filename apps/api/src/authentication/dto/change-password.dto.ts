import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, IsStrongPassword } from 'class-validator';

import { Match } from '../../utils/decorators/match.decorator';

export class ChangePasswordDto {
  @IsNotEmpty({ message: 'Current password is required' })
  @IsString()
  @ApiProperty({
    description: 'Current password of the user',
    example: 'OldP@ssw0rd123'
  })
  old_password: string;

  @IsNotEmpty({ message: 'New password is required' })
  @IsString()
  @IsStrongPassword(
    { minLength: 8, minUppercase: 1, minLowercase: 1, minNumbers: 1, minSymbols: 0 },
    {
      message: 'Password must contain at least 8 characters, one uppercase letter, one lowercase letter, and one number'
    }
  )
  @ApiProperty({
    description: 'New password for the user',
    example: 'NewP@ssw0rd123'
  })
  new_password: string;

  @IsNotEmpty({ message: 'Password confirmation is required' })
  @IsString()
  @Match('new_password', { message: 'Passwords do not match' })
  @ApiProperty({
    description: 'Confirmation of the new password',
    example: 'NewP@ssw0rd123'
  })
  confirm_new_password: string;
}

export class ChangePasswordResponseDto {
  @ApiProperty({
    description: 'Success message after password change',
    example: 'Password changed successfully'
  })
  message: string;

  constructor(message = 'Password changed successfully') {
    this.message = message;
  }
}
