import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class CreateAlgorithmDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({ example: 'Test Algorithm' })
  name: string;

  @IsBoolean()
  @ApiProperty({ example: true })
  status?: boolean;
}
