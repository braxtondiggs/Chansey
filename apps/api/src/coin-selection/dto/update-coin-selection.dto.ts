import { PartialType } from '@nestjs/swagger';

import { CreateCoinSelectionDto } from './create-coin-selection.dto';

export class UpdateCoinSelectionDto extends PartialType(CreateCoinSelectionDto) {}
