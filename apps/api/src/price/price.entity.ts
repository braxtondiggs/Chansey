import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, Timestamp } from 'typeorm';

import { Coin } from '../coin/coin.entity';

@Entity()
export class Price {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ type: 'decimal', default: 0 })
  @ApiProperty()
  price: number;

  @Column({ type: 'decimal', default: 0 })
  @ApiProperty()
  marketCap: number;

  @Column({ type: 'timestamptz' })
  @ApiProperty()
  geckoLastUpdatedAt: Timestamp;

  @ManyToOne(() => Coin, (coin) => coin.prices, { eager: true })
  coin: Coin;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;
}
