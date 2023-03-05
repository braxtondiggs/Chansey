import { Entity, PrimaryKey, Property, SerializedPrimaryKey } from '@mikro-orm/core';
import { ObjectId } from '@mikro-orm/mongodb';

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
  symbol: string;

  @Property()
  description?: string;

  @Property()
  image?: string;

  @Property()
  genesis?: string;

  @Property()
  marketRank?: number;

  @Property()
  geckoRank?: number;

  @Property()
  developerScore?: number;

  @Property()
  communityScore?: number;

  @Property()
  liquidityScore?: number;

  @Property()
  PublicInterestScore?: number;

  @Property()
  sentiment_up?: number;

  @Property()
  sentiment_down?: number;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  constructor(coin: Partial<Coin>) {
    Object.assign(this, coin);
  }
}
