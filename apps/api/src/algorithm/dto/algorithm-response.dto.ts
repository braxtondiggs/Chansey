import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';

export class AlgorithmResponseDto {
  @ApiProperty({
    description: 'Unique identifier for the algorithm',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  @Expose()
  id: string;

  @ApiProperty({
    description: 'Name of the algorithm',
    example: 'My Algorithm'
  })
  @Expose()
  name: string;

  @ApiProperty({
    description: 'Slugified name of the algorithm',
    example: 'my-algorithm'
  })
  @Expose()
  slug: string;

  @ApiProperty({
    description: 'Service name derived from the algorithm name',
    example: 'MyAlgorithmService'
  })
  @Expose()
  service: string;

  @ApiProperty({
    description: 'Description of the algorithm',
    example: 'This algorithm performs XYZ operations.',
    required: false
  })
  @Expose()
  description?: string;

  @ApiProperty({
    description: 'Status of the algorithm',
    example: false
  })
  @Expose()
  status: boolean;

  @ApiProperty({
    description: 'Evaluate flag for the algorithm',
    example: true
  })
  @Expose()
  evaluate: boolean;

  @ApiProperty({
    description: 'Weight of the algorithm',
    example: 1.5,
    required: false
  })
  @Expose()
  weight?: number;

  @ApiProperty({
    description: 'Cron schedule for the algorithm',
    example: '* * * * *'
  })
  @Expose()
  cron: string;

  constructor(partial: Partial<AlgorithmResponseDto>) {
    Object.assign(this, partial);
  }
}
