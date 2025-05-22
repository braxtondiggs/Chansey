import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn
} from 'typeorm';

import { ExchangeKey } from '../exchange/exchange-key/exchange-key.entity';
import { Order } from '../order/order.entity';
import { Portfolio } from '../portfolio/portfolio.entity';
import { Risk } from '../risk/risk.entity';

@Entity()
export class User {
  @PrimaryColumn({ unique: true })
  id: string;

  @Column()
  given_name: string;

  @Column()
  family_name: string;

  @Column()
  email: string;

  @Column({ nullable: true })
  middle_name?: string;

  @Column({ nullable: true })
  nickname?: string;

  @Column({ nullable: true })
  birthdate?: string;

  @Column({ nullable: true })
  gender?: string;

  @Column({ nullable: true })
  phone_number?: string;

  @Column({ nullable: true })
  picture?: string;

  rememberMe: boolean;
  token: string;

  @Exclude()
  id_token: string;

  @Exclude()
  expires_in: number;

  @CreateDateColumn({ select: false, type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ select: false, type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.user, {
    cascade: true
  })
  portfolios: Portfolio[];

  @OneToMany(() => Order, (order) => order.user, { cascade: true })
  orders: Order[];

  @ManyToOne(() => Risk, (risk) => risk.users, {
    eager: true
  })
  @JoinColumn({ name: 'risk' })
  risk: Risk;

  exchanges: ExchangeKey[];

  constructor(partial: Partial<User>) {
    Object.assign(this, partial);
  }
}
