import { IsUUID } from 'class-validator';

export class AlgoIdParams {
  @IsUUID()
  algoId: string;
}
