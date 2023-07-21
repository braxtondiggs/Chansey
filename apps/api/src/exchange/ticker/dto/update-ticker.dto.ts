import { PartialType } from '@nestjs/swagger';

import { CreateTickerDto } from './create-ticker.dto';

export class UpdateTickerDto extends PartialType(CreateTickerDto) {}
