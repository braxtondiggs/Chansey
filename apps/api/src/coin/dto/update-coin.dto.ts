import { PartialType } from '@nestjs/mapped-types';

import { CreateCoinDto } from './create-coin.dto';

export class UpdateCoinDto extends PartialType(CreateCoinDto) {}
