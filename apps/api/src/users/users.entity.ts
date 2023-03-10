import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from 'crypto';
import { promisify } from 'util';

import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Timestamp,
  UpdateDateColumn
} from 'typeorm';

import { Portfolio } from '../portfolio/portfolio.entity';

const iv = randomBytes(16);
const key2 = createHash('sha256').update(String(process.env.JWT_SECRET)).digest('base64').substr(0, 32);

@Entity()
export default class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  @Column()
  password: string;

  @CreateDateColumn({ select: false })
  createdAt: Timestamp;

  @UpdateDateColumn({ select: false })
  updatedAt: Timestamp;

  @OneToMany(() => Portfolio, (portfolio) => portfolio.user)
  portfolios: Portfolio[];

  /*@Property({
    hidden: false,
    onUpdate: async (user: User) => {
      console.log('onUpdate');
      console.log(user);
      // const key = (await promisify(scrypt)('user.binance', 'salt', 32)) as Buffer;
      // const cipher = createCipheriv('aes-256-ctr', key2, iv);
      user.binance = 'hello'; // Buffer.concat([cipher.update(key), cipher.final()]).toString();
      // return user;
      return 'hello';
    }
  })
  binance: string;

  @Property({ name: 'binanceAPIKey', persist: false, hidden: false })
  get binanceAPIKey(): string {
    const decipher = createDecipheriv('aes-256-ctr', key2, iv);
    return Buffer.concat([decipher.update(Buffer.from('this.binance')), decipher.final()]).toString();
  }*/
}
