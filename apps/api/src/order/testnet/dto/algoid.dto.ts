import { IsUUID } from 'class-validator';

export default class algoIdParams {
  @IsUUID()
  algoId: string;
}
