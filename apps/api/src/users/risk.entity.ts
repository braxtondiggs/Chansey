import { Exclude } from 'class-transformer';
import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';

import { User } from './users.entity';

@Entity()
export class Risk {
  @PrimaryGeneratedColumn('uuid')
  @Exclude()
  id: string;

  @Column()
  name: string;

  @Column()
  @Exclude()
  description: string;

  @Column()
  level: number;

  @OneToMany(() => User, (user) => user.risk)
  users: User[];
}
