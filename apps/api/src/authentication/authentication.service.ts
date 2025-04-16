import { Authorizer } from '@authorizerdev/authorizer-js';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CreateUserDto } from '../users/dto/create-user.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthenticationService {
  constructor(
    readonly config: ConfigService,
    private readonly user: UsersService
  ) {}

  public auth = new Authorizer({
    authorizerURL: this.config.get<string>('AUTHORIZER_URL'),
    clientID: this.config.get<string>('AUTHORIZER_CLIENT_ID'),
    redirectURL: this.config.get<string>('AUTHORIZER_REDIRECT_URL')
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
      const authUser = await this.auth.login({ email, password });
      if (!authUser) return authUser;
      return await this.user
        .getById(authUser.user.id)
        .then(() => authUser)
        .catch(async () => await this.user.create(authUser.user.id))
        .finally(() => authUser);
    } catch (error) {
      throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
    }
  }

  public validateAPIKey(key: string) {
    const APIKey = this.config.get('CHANSEY_API_KEY');
    if (key === APIKey) return true;
  }
}
