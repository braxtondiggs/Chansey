import { EntityRepository } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { Injectable } from '@nestjs/common';

import { CreateUserDto } from './dto/createUser.dto';
import User from './user.entity';

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
}

export default UsersService;
