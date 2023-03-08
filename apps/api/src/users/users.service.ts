import { EntityRepository, wrap } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

import { CreateUserDto, UpdateUserDto } from './dto';
import User from './users.entity';

@Injectable()
class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: EntityRepository<User>
  ) {}

  async getByEmail(email: string) {
    const user = await this.userRepository.findOne({ email });
    return user;
  }

  async getById(id: string) {
    const user = await this.userRepository.findOne({ id });
    return user;
  }

  async create(user: CreateUserDto) {
    const newUser = this.userRepository.create(user);
    await this.userRepository.persistAndFlush(newUser);
    return newUser;
  }

  async updateUser(dto: UpdateUserDto, user: User) {
    const existingItem = await this.getById(user.id);
    wrap(existingItem).assign(dto);
    await this.userRepository.persistAndFlush(existingItem);
    return existingItem;
  }
}

export default UsersService;
