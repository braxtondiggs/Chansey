import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class Category {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({
    description: 'Unique identifier for the category',
    example: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
  })
  id: string;

  @Column({ unique: true })
  @ApiProperty({
    description: 'Unique slug identifier for the category',
    example: 'technology'
  })
  slug: string;

  @Column()
  @ApiProperty({
    description: 'Name of the category',
    example: 'Technology'
  })
  name: string;

  @CreateDateColumn({
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP'
  })
  @ApiProperty({
    description: 'Timestamp when the category was created',
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
    description: 'Timestamp when the category was last updated',
    example: '2024-04-23T18:25:43.511Z',
    type: 'string',
    format: 'date-time'
  })
  updatedAt: Date;

  constructor(partial: Partial<Category>) {
    Object.assign(this, partial);
  }
}
