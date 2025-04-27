import { PartialType } from '@nestjs/mapped-types';

import { CreateRiskDto } from './create-risk.dto';

export class UpdateRiskDto extends PartialType(CreateRiskDto) {}
