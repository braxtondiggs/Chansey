import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';

import RegisterDto from './dto/register.dto';
import TokenPayload from './tokenPayload.interface';
import UsersService from '../users/users.service';
import isRecord from '../utils/isRecord';

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly user: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  public async register(registrationData: RegisterDto) {
    const hashedPassword = await hash(registrationData.password, 10);
    try {
      return await this.user.create({
        ...registrationData,
        password: hashedPassword
      });
    } catch (error: unknown) {
      if (isRecord(error) && error.code === '23505') {
        throw new HttpException('User with that email already exists', HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Something went wrong', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  public getCookieWithJwtToken(userId: string) {
    const payload: TokenPayload = { userId };
    const token = this.jwt.sign(payload);
    return `Authentication=${token}; HttpOnly; Path=/; Max-Age=${this.config.get('JWT_EXPIRATION_TIME')}`;
  }

  public getCookieForLogOut() {
    return `Authentication=; HttpOnly; Path=/; Max-Age=0`;
  }

  public async getAuthenticatedUser(email: string, plainTextPassword: string) {
    try {
      const user = await this.user.getByEmail(email);
      await this.verifyPassword(plainTextPassword, user.password);
      return user;
    } catch (error) {
      throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
    }
  }

  private async verifyPassword(plainTextPassword: string, hashedPassword: string) {
    const isPasswordMatching = await compare(plainTextPassword, hashedPassword);
    if (!isPasswordMatching) {
      throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
    }
  }
}
