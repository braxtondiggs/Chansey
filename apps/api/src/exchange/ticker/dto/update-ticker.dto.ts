import { PartialType } from '@nestjs/mapped-types';

import { CreateTickerDto } from './create-ticker.dto';

export class UpdateTickerDto extends PartialType(CreateTickerDto) {}
