import { IsString } from 'class-validator';

export default class FindOneParams {
  @IsString()
  id: string;
}
