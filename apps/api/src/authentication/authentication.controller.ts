import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { FastifyReply } from 'fastify';

import {
  ForgotPasswordDto,
  LogInDto,
  LoginResponseDto,
  LogoutResponseDto,
  RegisterResponseDto
} from '@chansey/api-interfaces';

import { AuthenticationService } from './authentication.service';
import JwtAuthenticationGuard from './guard/jwt-authentication.guard';
import { LocalAuthenticationGuard } from './guard/localAuthentication.guard';

import GetUser from '../authentication/decorator/get-user.decorator';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { User } from '../users/users.entity';

@ApiTags('Authentication')
@Controller('auth')
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description: 'Registers a new user with the provided details.'
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The user has been successfully registered.',
    type: RegisterResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  async register(@Body() user: CreateUserDto) {
    return this.authentication.register(user);
  }

  @Post('login')
  @ApiOperation({
    summary: 'Login to the application',
    description: 'Authenticates a user using email and password.'
  })
  @ApiBody({ type: LogInDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User logged in successfully.',
    type: LoginResponseDto
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid credentials.'
  })
  @ApiBearerAuth('token')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthenticationGuard)
  async logIn(@GetUser() user: User, @Res() response: FastifyReply) {
    const rememberMe = user.rememberMe || false;
    const cookie = this.authentication.getCookieWithJwtToken(user.id_token, user.expires_in, rememberMe);
    response.header('Set-Cookie', cookie);
    return response.send(user);
  }

  @Post('logout')
  @ApiOperation({
    summary: 'Logout of the application',
    description: 'Logs out the authenticated user by clearing cookies.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'User logged out successfully.',
    type: LogoutResponseDto
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid credentials.'
  })
  @UseGuards(JwtAuthenticationGuard)
  @ApiBearerAuth('token')
  async logOut(@Res() response: FastifyReply) {
    response
      .header('Set-Cookie', this.authentication.getCookieForLogOut())
      .clearCookie('Authentication')
      .clearCookie('Refresh')
      .status(HttpStatus.OK)
      .send(new LogoutResponseDto('Logout successful'));
    return { message: 'Logout successful' };
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Forgot Password',
    description: 'Sends a password reset link to the provided email address.'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password reset link sent successfully.'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid email address.'
  })
  async forgotPassword(@Body() { email }: ForgotPasswordDto) {
    const { data } = await this.authentication.auth.forgotPassword({ email });
    return (
      data || {
        message: 'Please check your inbox! We have sent a password reset link.',
        should_show_mobile_otp_screen: null
      }
    );
  }
}
