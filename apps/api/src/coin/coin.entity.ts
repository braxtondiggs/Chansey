import { Entity, PrimaryKey, Property, SerializedPrimaryKey } from '@mikro-orm/core';
import type { ObjectId } from '@mikro-orm/mongodb';

@Entity()
export class Coin {

  @PrimaryKey()
  _id!: ObjectId;

  @SerializedPrimaryKey()
  id!: string;

  @Property()
  slug!: string;

  @Property()
  name!: string;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  constructor(slug: string, name: string) {
    this.slug = slug;
    this.name = name;
  }
}
