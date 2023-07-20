import { PartialType } from '@nestjs/mapped-types';

import { CreateExchangeDto } from './create-exchange.dto';

export class UpdateExchangeDto extends PartialType(CreateExchangeDto) {}
