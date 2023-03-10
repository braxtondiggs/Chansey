import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';

import { CreateUserDto, UpdateUserDto } from './dto';
import User from './users.entity';

@Injectable()
class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>
  ) {}

  async getByEmail(email: string) {
    return await this.user.findOne({ where: { email }, relations: ['portfolios'] });
  }

  async getById(id: string) {
    return await this.user.findOneBy({ id });
  }

  async create(user: CreateUserDto) {
    return (await this.user.insert(user)).generatedMaps[0] as User;
  }

  async update(user: UpdateUserDto) {
    return await this.user.save(user);
  }
}

export default UsersService;
