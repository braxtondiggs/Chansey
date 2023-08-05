import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, Validate } from 'class-validator';

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

  @IsString()
  @Validate(
    (text: string) =>
      new RegExp(
        /^(\*|((\*\/)?[1-5]?[0-9])) (\*|((\*\/)?[1-5]?[0-9])) (\*|((\*\/)?(1?[0-9]|2[0-3]))) (\*|((\*\/)?([1-9]|[12][0-9]|3[0-1]))) (\*|((\*\/)?([1-9]|1[0-2]))) (\*|((\*\/)?[0-6]))$/
      ).test(text),
    {
      message: 'Cron expression is not valid'
    }
  )
  @ApiProperty({
    example: '* * * * *',
    required: false,
    default: '* * * * *',
    description: 'Cron expression for this algorithm'
  })
  cron?: string;
}
