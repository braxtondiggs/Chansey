import { ApiProperty } from '@nestjs/swagger';
import {
  AfterInsert,
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { ColumnNumericTransformer } from './../utils/transformers/columnNumeric.transformer';

@Entity()
@Index(['status', 'evaluate'])
export class Algorithm {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Index()
  @Column({ unique: true })
  @ApiProperty()
  name: string;
  slug: string;
  service: string;

  @Column({ nullable: true })
  @ApiProperty()
  description?: string;

  @Index()
  @Column({ default: false })
  @ApiProperty()
  status: boolean;

  @Column({ default: true })
  @ApiProperty()
  evaluate: boolean;

  @Column({ type: 'decimal', transformer: new ColumnNumericTransformer(), nullable: true })
  @ApiProperty()
  weight?: number;

  @Column({ default: '* * * * *' })
  @ApiProperty()
  cron: string;

  @CreateDateColumn({ select: false, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false, default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Timestamp;

  @AfterLoad()
  @AfterInsert()
  async generateSlug() {
    this.slug = this.name
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^\w\s-]+/g, '')
      .replace(/\\-\\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }

  @AfterLoad()
  @AfterInsert()
  async generateServiceName() {
    this.service = `${this.name.replace(/\s+/g, '')}Service`;
  }

  constructor(partial: Partial<Algorithm>) {
    Object.assign(this, partial);
  }
}
