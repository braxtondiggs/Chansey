import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

import { AuthenticationService } from './authentication.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LogInDto } from './dto/login.dto';
import JwtAuthenticationGuard from './guard/jwt-authentication.guard';
import { LocalAuthenticationGuard } from './guard/localAuthentication.guard';
import RequestWithUser from './interface/requestWithUser.interface';
import { CreateUserDto } from '../users/dto/create-user.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Post('register')
  @ApiOperation({ description: 'Register a new user', summary: 'Register' })
  async register(@Body() user: CreateUserDto) {
    return this.authentication.register(user);
  }

  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthenticationGuard)
  @Post('login')
  @ApiOperation({ description: 'Login to the application', summary: 'Login' })
  @ApiResponse({ status: HttpStatus.OK, description: 'User logged in successfully' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid credentials' })
  @ApiBody({ type: LogInDto })
  @ApiBearerAuth('token')
  async logIn(@Req() { user }: RequestWithUser, @Res() response: FastifyReply) {
    const cookie = this.authentication.getCookieWithJwtToken(user.id_token, user.expires_in);
    response.header('Set-Cookie', cookie);
    return response.send(user);
  }

  @UseGuards(JwtAuthenticationGuard)
  @Post('logout')
  @ApiOperation({ description: 'Logout of the application', summary: 'Logout' })
  @ApiResponse({ status: HttpStatus.OK, description: 'User logged out successfully' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Invalid credentials' })
  @ApiBearerAuth('token')
  async logOut(@Res() response: FastifyReply) {
    response.header('Set-Cookie', this.authentication.getCookieForLogOut());
    return { message: 'Logout successful' };
  }

  @Post('forgot-password')
  @ApiOperation({ description: 'Forgot password', summary: 'Forgot password' })
  async forgotPassword(@Body() { email }: ForgotPasswordDto) {
    return this.authentication.auth.forgotPassword({ email });
  }
}
