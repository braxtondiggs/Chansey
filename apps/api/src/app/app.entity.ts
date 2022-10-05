import { Entity, PrimaryKey } from '@mikro-orm/core';
import type { ObjectId } from '@mikro-orm/mongodb';

@Entity()
export class Book {

  @PrimaryKey()
  _id: ObjectId;

  name!: string;
}
