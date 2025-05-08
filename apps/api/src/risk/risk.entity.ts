import { ApiProperty } from '@nestjs/swagger';

import { Column, Entity, OneToMany, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

import { Risk as RiskInterface } from '@chansey/api-interfaces';

import { User } from '../users/users.entity';

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

  @OneToMany(() => User, (user) => user.risk)
  users: User[];
}
