import { PartialType } from '@nestjs/mapped-types';

import { type UpdateRisk } from '@chansey/api-interfaces';

import { CreateRiskDto } from './create-risk.dto';

export class UpdateRiskDto extends PartialType(CreateRiskDto) implements Omit<UpdateRisk, 'id'> {}
