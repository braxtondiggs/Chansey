import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UpdateUserDto } from './dto';
import { User } from './users.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly user: Repository<User>
  ) {}

  async create(id: string) {
    try {
      const newUser = this.user.create({ id });
      await this.user.save(newUser);
      this.logger.debug(`User created with ID: ${id}`);
      return newUser;
    } catch (error) {
      this.logger.error(`Failed to create user with ID: ${id}`, error.stack);
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async update(updateUserDto: UpdateUserDto, user: User) {
    try {
      const updatedUser = this.user.merge(user, updateUserDto);
      await this.user.save(updatedUser);
      this.logger.debug(`User updated with ID: ${user.id}`);
      return updatedUser;
    } catch (error) {
      this.logger.error(`Failed to update user with ID: ${user.id}`, error.stack);
      throw new InternalServerErrorException('Failed to update user');
    }
  }

  async getById(id: string) {
    try {
      const user = await this.user.findOneOrFail({ where: { id } });
      this.logger.debug(`User retrieved with ID: ${id}`);
      return user;
    } catch (error) {
      this.logger.error(`User not found with ID: ${id}`, error.stack);
      throw new NotFoundException(`User with ID ${id} not found`);
    }
  }

  async findAll() {
    try {
      return await this.user.find();
    } catch (error) {
      this.logger.error(`Failed to retrieve all users`, error.stack);
      throw new InternalServerErrorException('Failed to retrieve users');
    }
  }
}
