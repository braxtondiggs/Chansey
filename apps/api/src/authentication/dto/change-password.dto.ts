import { ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    description: 'Current password of the user',
    example: 'OldP@ssw0rd123'
  })
  @IsNotEmpty()
  @IsString()
  old_password: string;

  @ApiProperty({
    description: 'New password for the user',
    example: 'NewP@ssw0rd123'
  })
  @IsNotEmpty()
  @IsString()
  @MinLength(8)
  @Matches(/((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/, {
    message: 'Password must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number or special character'
  })
  new_password: string;

  @ApiProperty({
    description: 'Confirmation of the new password',
    example: 'NewP@ssw0rd123'
  })
  @IsNotEmpty()
  @IsString()
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
