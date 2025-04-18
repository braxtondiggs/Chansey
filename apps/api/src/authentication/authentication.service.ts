import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Authorizer } from '@authorizerdev/authorizer-js';

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
      const { data, errors } = await this.auth.signup(registrationData);
      if (errors.length) throw new HttpException(errors, HttpStatus.BAD_REQUEST);
      if (data) await this.user.create(data?.user?.id);
      return data;
    } catch (error: any) {
      if (error?.response[0]?.message === 'signup is disabled for this instance')
        throw new HttpException('Signup has been temporarily disabled', HttpStatus.BAD_REQUEST);
      throw new HttpException('Something went wrong', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  public getCookieWithJwtToken(token: string, expires_in: number, rememberMe = false) {
    // If rememberMe is true, set a longer expiration (30 days), otherwise use the provided expires_in
    const expiration = rememberMe ? 30 * 24 * 60 * 60 : expires_in;
    return `Authentication=${token}; HttpOnly; Path=/; Max-Age=${expiration}`;
  }

  public getCookieForLogOut() {
    return `Authentication=; HttpOnly; Path=/; Max-Age=0`;
  }

  public async getAuthenticatedUser(email: string, password: string, rememberMe = false) {
    try {
      const { data: authUser, errors } = await this.auth.login({ email, password });
      if (!authUser || errors) return authUser;

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
