import { ApiProperty } from '@nestjs/swagger';

import { Expose } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Matches } from 'class-validator';
import {
  AfterInsert,
  AfterLoad,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn
} from 'typeorm';

import { ColumnNumericTransformer } from './../utils/transformers/columnNumeric.transformer';

@Entity()
@Index(['status', 'evaluate'])
export class Algorithm {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the algorithm',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @IsNotEmpty()
  @IsString()
  @Index()
  @Column({ unique: true })
  @ApiProperty({
    description: 'Name of the algorithm',
    example: 'My Algorithm'
  })
  name: string;

  @ApiProperty({
    description: 'Slugified name of the algorithm',
    example: 'my-algorithm'
  })
  @Expose()
  slug: string;

  @IsOptional()
  @IsString()
  @Column({ nullable: true })
  @ApiProperty({
    description: 'Service name for the algorithm',
    example: 'MyAlgorithmService',
    required: false
  })
  service?: string;

  @Column({ nullable: true })
  @ApiProperty({
    description: 'Description of the algorithm',
    example: 'This algorithm performs XYZ operations.',
    required: false
  })
  description?: string;

  @IsBoolean()
  @Index()
  @Column({ default: false })
  @ApiProperty({
    description: 'Status of the algorithm',
    example: false
  })
  status: boolean;

  @Column({ default: true })
  @ApiProperty({
    description: 'Evaluate flag for the algorithm',
    example: true
  })
  evaluate: boolean;

  @IsOptional()
  @IsNumber()
  @Column({
    type: 'decimal',
    transformer: new ColumnNumericTransformer(),
    nullable: true
  })
  @ApiProperty({
    description: 'Weight of the algorithm',
    example: 1.5,
    required: false
  })
  weight?: number;

  @IsString()
  @Matches(/^(\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+) (\*|[0-9]+)$/)
  @Column({ default: '* * * * *' })
  @ApiProperty({
    description: 'Cron schedule for the algorithm',
    example: '* * * * *'
  })
  cron: string;

  @CreateDateColumn({
    select: false,
    default: () => 'CURRENT_TIMESTAMP'
  })
  createdAt: Date;

  @UpdateDateColumn({
    select: false,
    default: () => 'CURRENT_TIMESTAMP'
  })
  updatedAt: Date;

  constructor(partial: Partial<Algorithm>) {
    Object.assign(this, partial);
  }

  @AfterLoad()
  @AfterInsert()
  setSlugAndService() {
    if (this.name) {
      this.slug = this.name
        .toLowerCase()
        .trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w-]+/g, '')
        .replace(/--+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');

      // Only set service if it's not already provided
      if (!this.service) {
        this.service = `${this.name.replace(/\s+/g, '')}Service`;
      }
    }
  }
}
