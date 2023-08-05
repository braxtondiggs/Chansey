import { ApiProperty } from '@nestjs/swagger';
import {
  AfterInsert,
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { ColumnNumericTransformer } from './../utils/transformers/columnNumeric.transformer';

@Entity()
export class Algorithm {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ unique: true })
  @ApiProperty()
  name: string;
  slug: string;

  @Column({ nullable: true })
  @ApiProperty()
  description: string;

  @Column({ default: false })
  @ApiProperty()
  status: boolean;

  @Column({ default: true })
  @ApiProperty()
  evaluate: boolean;

  @Column({ type: 'decimal', transformer: new ColumnNumericTransformer(), nullable: true })
  @ApiProperty()
  weight: number;

  @Column({ default: '* * * * *' })
  @ApiProperty()
  cron: string;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
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

  constructor(partial: Partial<Algorithm>) {
    Object.assign(this, partial);
  }
}
