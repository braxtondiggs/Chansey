import { IsBoolean, IsNotEmpty, IsString } from 'class-validator';

export class CreateAlgorithmDto {
  @IsNotEmpty()
  @IsString()
  name: string;

  @IsBoolean()
  @IsNotEmpty()
  status: boolean;
}
