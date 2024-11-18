import { PartialType } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import { CreateTickerDto } from './create-ticker-pair.dto';

export class UpdateTickerDto extends PartialType(CreateTickerDto) {
  @IsUUID()
  id: string;
}
