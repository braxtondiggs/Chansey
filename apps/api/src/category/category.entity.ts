import { ApiProperty } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Timestamp, UpdateDateColumn } from 'typeorm';

@Entity()
export class Category {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty()
  id: string;

  @Column({ unique: true })
  @ApiProperty()
  slug: string;

  @Column({ unique: true })
  @ApiProperty()
  name: string;

  @CreateDateColumn({ select: false })
  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  @ApiProperty({ type: 'string', format: 'date-time' })
  updatedAt: Timestamp;

  constructor(partial: Partial<Category>) {
    Object.assign(this, partial);
  }
}
