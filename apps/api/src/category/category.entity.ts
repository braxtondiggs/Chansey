import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Timestamp, UpdateDateColumn } from 'typeorm';

@Entity()
export class Category {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Index()
  @Column({ unique: true })
  @ApiProperty()
  slug: string;

  @Index()
  @Column({ unique: true })
  @ApiProperty()
  name: string;

  @CreateDateColumn({ select: false, default: () => 'CURRENT_TIMESTAMP' })
  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false, default: () => 'CURRENT_TIMESTAMP' })
  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt: Timestamp;

  constructor(partial: Partial<Category>) {
    Object.assign(this, partial);
  }
}
