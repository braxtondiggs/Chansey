import { Entity, ManyToOne, PrimaryKey, Property, SerializedPrimaryKey } from '@mikro-orm/core';
import { ObjectId } from '@mikro-orm/mongodb';

import { Coin } from '../coin/coin.entity';
import User from '../users/users.entity';

@Entity()
export class Portfolio {
  @PrimaryKey()
  _id!: ObjectId;

  @SerializedPrimaryKey()
  id!: string;

  @Property()
  type?: string = 'manual';

  @ManyToOne(() => Coin)
  coin: Coin;

  @ManyToOne()
  user: User;

  @Property()
  createdAt: Date = new Date();

  @Property({ onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  constructor(portfolio: Partial<Portfolio>) {
    Object.assign(this, portfolio);
  }
}
