import { PartialType } from '@nestjs/mapped-types';

import { CreateAlgorithmDto } from './create-algorithm.dto';

export class UpdateAlgorithmDto extends PartialType(CreateAlgorithmDto) {}
