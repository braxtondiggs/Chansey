import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString } from 'class-validator';

export class CreateAlgorithmDto {
  @IsString()
  @ApiProperty({
    example: 'Test Algorithm',
    required: true,
    description: 'Name of this algorithm, must be unique'
  })
  name: string;

  @IsBoolean()
  @ApiProperty({ example: true, required: false, default: false, description: 'Status of this algorithm' })
  status?: boolean;

  @IsBoolean()
  @ApiProperty({ example: true, required: false, default: true, description: 'Evaluate this algorithm in TestNet' })
  evaluate?: boolean;
}
