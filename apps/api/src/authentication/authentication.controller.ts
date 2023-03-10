import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

import { AuthenticationService } from './authentication.service';
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
  @ApiOperation({})
  async register(@Body() user: CreateUserDto) {
    return this.authentication.register(user);
  }

  @HttpCode(200)
  @UseGuards(LocalAuthenticationGuard)
  @Post('login')
  @ApiOperation({})
  @ApiBody({ type: LogInDto })
  @ApiBearerAuth('token')
  async logIn(@Req() request: RequestWithUser, @Res() response: FastifyReply) {
    const { user } = request;
    delete user.password;
    const cookie = this.authentication.getCookieWithJwtToken(user.id);
    response.header('Set-Cookie', cookie);
    return response.send(user);
  }

  @UseGuards(JwtAuthenticationGuard)
  @Post('logout')
  @ApiOperation({})
  @ApiBearerAuth('token')
  async logOut(@Res() response: FastifyReply) {
    response.header('Set-Cookie', this.authentication.getCookieForLogOut());
    return (response.statusCode = 200);
  }
}
