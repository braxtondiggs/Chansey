import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { Exchange } from '../exchange/exchange.entity';
import { User } from '../users/users.entity';

@Entity()
export class HistoricalBalance {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => Exchange)
  @JoinColumn({ name: 'exchangeId' })
  exchange: Exchange;

  @Column()
  exchangeId: string;

  @Column('jsonb')
  balances: {
    asset: string;
    free: string;
    locked: string;
    usdValue: number;
  }[];

  @Column('float')
  totalUsdValue: number;

  @Column({ type: 'timestamptz' })
  timestamp: Date;
}
