import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Authorizer, User as AuthorizerUser } from '@authorizerdev/authorizer-js';

import { VerifyOtpDto } from './dto';
import { ChangePasswordDto } from './dto/change-password.dto';

import { CreateUserDto } from '../users/dto/create-user.dto';
import { User } from '../users/users.entity';
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
      const { data, errors } = await this.auth.signup({ ...registrationData, redirect_uri: 'https://cymbit.com' });
      if (errors && errors.length > 0) throw new HttpException(errors, HttpStatus.BAD_REQUEST);
      if (!data || !data.user) {
        throw new HttpException('Registration failed: Something went wrong', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      if (data) {
        await this.user.create({
          id: data.user.id,
          email: data.user.email,
          given_name: data.user.given_name,
          family_name: data.user.family_name,
          middle_name: data.user.middle_name,
          nickname: data.user.nickname,
          birthdate: data.user.birthdate,
          gender: data.user.gender,
          phone_number: data.user.phone_number,
          picture: data.user.picture
        });
      }
      return data;
    } catch (error: any) {
      if (error?.response[0]?.message === 'signup is disabled for this instance')
        throw new HttpException('Signup has been temporarily disabled', HttpStatus.BAD_REQUEST);

      if (error instanceof HttpException) {
        throw error;
      }

      console.error('Registration error:', error);

      throw new HttpException(
        'Registration failed: ' + (error?.message || 'Unknown error occurred'),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  public getCookieWithJwtToken(token: string, expires_in: number, rememberMe = false) {
    // If rememberMe is true, set a longer expiration (30 days), otherwise use the provided expires_in
    const expiration = rememberMe ? 30 * 24 * 60 * 60 : expires_in;
    return `chansey_auth=${token}; Max-Age=${expiration}; Path=/; HttpOnly; Secure; SameSite=Strict`;
  }

  public getCookieForLogOut() {
    return `chansey_auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
  }

  public async getAuthenticatedUser(email: string, password: string, rememberMe = false) {
    try {
      const { data: authUser, errors } = await this.auth.login({ email, password });
      if (errors && errors.length > 0) {
        throw new HttpException(errors[0].message || 'Authentication failed', HttpStatus.BAD_REQUEST);
      }
      if (
        (authUser && authUser.should_show_email_otp_screen) ||
        authUser.should_show_totp_screen ||
        authUser.should_show_mobile_otp_screen
      ) {
        return authUser;
      }

      let userData: User;
      try {
        userData = await this.user.getById(authUser.user.id);
      } catch (error) {
        userData = await this.user.create({
          id: authUser.user.id,
          email: authUser.user.email,
          given_name: authUser.user.given_name,
          family_name: authUser.user.family_name,
          middle_name: authUser.user.middle_name,
          nickname: authUser.user.nickname,
          birthdate: authUser.user.birthdate,
          gender: authUser.user.gender,
          phone_number: authUser.user.phone_number,
          picture: authUser.user.picture
        });
      }

      userData.token = authUser.access_token;
      userData.rememberMe = rememberMe;
      userData.id_token = authUser.id_token;
      userData.expires_in = authUser.expires_in;

      const combinedUserData = {
        ...authUser,
        user: {
          ...authUser.user,
          ...userData
        }
      };
      return combinedUserData;
    } catch (error) {
      if (error?.message === 'bad user credentials' || error?.message === 'user not found') {
        throw new HttpException('Wrong credentials provided', HttpStatus.BAD_REQUEST);
      } else {
        // Log the unexpected error and throw a generic message
        console.error('Authentication error:', error);
        throw new HttpException(
          'Authentication failed: ' + (error?.message || 'Unknown error occurred'),
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    }
  }

  public validateAPIKey(key: string) {
    const APIKey = this.config.get('CHANSEY_API_KEY');
    if (key === APIKey) return true;
  }

  public async verifyOtp(verifyOtp: VerifyOtpDto) {
    const { data, errors } = await this.auth.verifyOtp(verifyOtp);

    if (errors.length) {
      throw new HttpException(errors[0], HttpStatus.BAD_REQUEST);
    }

    return data;
  }

  public async resendOtp(email: string) {
    const { data, errors } = await this.auth.resendOtp({ email });
    if (errors.length) {
      throw new HttpException(errors[0], HttpStatus.BAD_REQUEST);
    }
    return data;
  }

  public async changePassword(user: User, changePasswordData: ChangePasswordDto) {
    try {
      const { old_password, new_password, confirm_new_password } = changePasswordData;

      if (new_password !== confirm_new_password) {
        throw new HttpException('New password and confirmation do not match', HttpStatus.BAD_REQUEST);
      }

      const Authorization = user.token;
      const { data, errors } = await this.auth.updateProfile(
        {
          old_password,
          new_password,
          confirm_new_password
        },
        { Authorization }
      );

      if (errors && errors.length) {
        throw new HttpException(errors[0], HttpStatus.BAD_REQUEST);
      }

      return data || { message: 'Password changed successfully' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Failed to change password: ' + (error?.message || 'Unknown error occurred'),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
