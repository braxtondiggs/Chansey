import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { Risk as RiskInterface } from '@chansey/api-interfaces';

import type { User } from '../users/users.entity';

@Entity()
export class Risk implements RiskInterface {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  description: string;

  @Column()
  level: number;

  @Column({ default: 10 })
  @ApiProperty({
    description: 'Number of coins to auto-select for this risk level',
    example: 12
  })
  coinCount: number;

  @Column({ type: 'varchar', nullable: true })
  @ApiProperty({
    description: 'Cron pattern for coin selection updates (null = no auto-updates)',
    example: '0 2 * * 1',
    nullable: true
  })
  selectionUpdateCron: string | null;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP'
  })
  @ApiProperty({
    description: 'Timestamp when the risk level was created',
    example: '2024-04-23T18:25:43.511Z',
    type: 'string',
    format: 'date-time'
  })
  createdAt: Date;

  @UpdateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP'
  })
  @ApiProperty({
    description: 'Timestamp when the risk level was last updated',
    example: '2024-04-23T18:25:43.511Z',
    type: 'string',
    format: 'date-time'
  })
  updatedAt: Date;

  @OneToMany('User', 'coinRisk')
  users: Relation<User[]>;
}
