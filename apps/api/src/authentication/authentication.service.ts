import { Authorizer } from '@authorizerdev/authorizer-js';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { CreateUserDto } from '../users/dto/create-user.dto';
import UsersService from '../users/users.service';

@Injectable()
export class AuthenticationService {
  constructor(
    private readonly user: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {}

  public auth = new Authorizer({
    authorizerURL: 'https://authorizer-production-ffa1.up.railway.app',
    clientID: '9c5ae276-7627-4240-bb9d-8b4bff96891b',
    redirectURL: 'https://chansey.up.railway.app'
  });

  public async register(registrationData: CreateUserDto) {
    try {
      const response = await this.auth.signup(registrationData);
      if (response) await this.user.create(response?.user?.id);
      return response;
    } catch (error: unknown) {
      throw new HttpException('Something went wrong', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  public getCookieWithJwtToken(token: string, expires_in: number) {
    return `Authentication=${token}; HttpOnly; Path=/; Max-Age=${expires_in}`;
  }

  public getCookieForLogOut() {
    return `Authentication=; HttpOnly; Path=/; Max-Age=0`;
  }

  public async getAuthenticatedUser(email: string, password: string) {
    try {
      return await this.auth.login({ email, password });
    } catch (error) {
      throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
    }
  }
}
