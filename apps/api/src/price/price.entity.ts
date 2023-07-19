import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, Timestamp } from 'typeorm';

import { Coin } from '../coin/coin.entity';

@Entity()
export class Price {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ type: 'decimal' })
  @ApiProperty()
  price: number;

  @ManyToOne(() => Coin, (coin) => coin.prices, { eager: true })
  coin: Coin;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;
}
