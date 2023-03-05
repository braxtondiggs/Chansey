import { Entity, ManyToOne, PrimaryKey, Property, SerializedPrimaryKey } from '@mikro-orm/core';
import { ObjectId } from '@mikro-orm/mongodb';

import { Coin } from '../coin/coin.entity';

@Entity()
export class Price {
  @PrimaryKey()
  _id!: ObjectId;

  @SerializedPrimaryKey()
  id!: string;

  @Property()
  price!: number;

  @ManyToOne(() => Coin)
  coin: Coin;

  @Property()
  createdAt: Date = new Date();

  constructor(price: Partial<Price>) {
    Object.assign(this, price);
  }
}
