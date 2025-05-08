import { IsNotEmpty, IsNumber, IsString, Max, Min } from 'class-validator';

import { CreateRisk } from '@chansey/api-interfaces';

export class CreateRiskDto implements CreateRisk {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsNumber()
  @Min(1)
  @Max(10)
  level: number;
}
