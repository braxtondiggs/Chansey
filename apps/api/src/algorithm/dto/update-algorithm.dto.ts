import { PartialType } from '@nestjs/swagger';

import { CreateAlgorithmDto } from './create-algorithm.dto';

export class UpdateAlgorithmDto extends PartialType(CreateAlgorithmDto) {}
