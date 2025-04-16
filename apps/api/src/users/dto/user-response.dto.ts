import { ApiProperty } from '@nestjs/swagger';

import { Risk } from '../risk.entity';
import { CreateUserDto } from './create-user.dto';

export class UserResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the user',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @ApiProperty({
    description: 'Given name of the user',
    example: 'Braxton'
  })
  given_name: string;

  @ApiProperty({
    description: 'Family name of the user',
    example: 'Diggs'
  })
  family_name: string;

  @ApiProperty({
    description: 'Email address of the user',
    example: 'braxtondiggs@gmail.com'
  })
  email: string;

  @ApiProperty({
    description: 'Risk profile of the user',
    example: {
      name: 'Moderate',
      level: 3
    }
  })
  risk: Risk;

  constructor(user: Partial<CreateUserDto>) {
    Object.assign(this, user);
  }
}
