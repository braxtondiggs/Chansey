import { ApiProperty } from '@nestjs/swagger';

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';

import { CoinSelectionSource } from './coin-selection-source.enum';
import { CoinSelectionType } from './coin-selection-type.enum';

import { Coin } from '../coin/coin.entity';
import { User } from '../users/users.entity';

@Entity('coin_selection')
export class CoinSelection {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the coin selection item',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({
    type: 'enum',
    enum: CoinSelectionType,
    default: CoinSelectionType.MANUAL,
    enumName: 'coin_selection_type_enum'
  })
  @ApiProperty({
    description: 'Type of the coin selection item',
    example: CoinSelectionType.MANUAL,
    enum: CoinSelectionType
  })
  type: CoinSelectionType;

  @Column({
    type: 'enum',
    enum: CoinSelectionSource,
    nullable: true,
    default: null,
    enumName: 'coin_selection_source_enum'
  })
  @ApiProperty({
    description: 'Source that created this selection (null for manual/watched)',
    example: CoinSelectionSource.RISK_BASED,
    enum: CoinSelectionSource,
    nullable: true,
    required: false
  })
  source: CoinSelectionSource | null;

  @CreateDateColumn({ type: 'timestamptz', select: false })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', select: false })
  updatedAt: Date;

  @Index('coin_selection_coinId_index')
  @ManyToOne('Coin', 'coinSelections', {
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'Coin associated with this selection item',
    type: () => Coin
  })
  coin: Relation<Coin>;

  @Index('coin_selection_userId_index')
  @ManyToOne('User', 'coinSelections', {
    nullable: false,
    onDelete: 'CASCADE'
  })
  @ApiProperty({
    description: 'User who owns this coin selection item',
    type: () => User
  })
  user: Relation<User>;

  constructor(partial: Partial<CoinSelection>) {
    Object.assign(this, partial);
  }
}

export enum CoinSelectionRelations {
  COIN = 'coin',
  USER = 'user'
}
