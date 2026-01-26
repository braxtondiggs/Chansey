import { ApiProperty } from '@nestjs/swagger';

import { IsNumber, IsString, Min } from 'class-validator';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn
} from 'typeorm';

import { PaperTradingSession } from './paper-trading-session.entity';

import { ColumnNumericTransformer } from '../../../utils/transformers';

@Entity('paper_trading_accounts')
@Index(['session'])
@Unique(['session', 'currency'])
export class PaperTradingAccount {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Unique identifier for the account' })
  id: string;

  @IsString()
  @Column({ type: 'varchar', length: 20 })
  @ApiProperty({ description: 'Currency symbol (e.g., USD, BTC, ETH)' })
  currency: string;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Available balance', default: 0 })
  available: number;

  @IsNumber()
  @Min(0)
  @Column({ type: 'decimal', precision: 18, scale: 8, default: 0, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Locked balance (in pending orders)', default: 0 })
  locked: number;

  @IsNumber()
  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, transformer: new ColumnNumericTransformer() })
  @ApiProperty({ description: 'Average cost basis for the asset', required: false })
  averageCost?: number;

  @CreateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the account was created' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  @ApiProperty({ description: 'When the account was last updated' })
  updatedAt: Date;

  // Relations
  @ManyToOne(() => PaperTradingSession, (session) => session.accounts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  @ApiProperty({ description: 'Paper trading session this account belongs to' })
  session: Relation<PaperTradingSession>;

  /**
   * Get the total balance (available + locked)
   */
  get total(): number {
    return this.available + this.locked;
  }

  constructor(partial: Partial<PaperTradingAccount>) {
    Object.assign(this, partial);
  }
}
