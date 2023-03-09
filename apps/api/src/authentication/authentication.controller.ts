import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FastifyReply } from 'fastify';

import { AuthenticationService } from './authentication.service';
import { LogInDto, RegisterDto } from './dto';
import JwtAuthenticationGuard from './jwt-authentication.guard';
import { LocalAuthenticationGuard } from './localAuthentication.guard';
import RequestWithUser from './requestWithUser.interface';

@ApiTags('Authentication')
@Controller('auth')
export class AuthenticationController {
  constructor(private readonly authentication: AuthenticationService) {}

  @Post('register')
  @ApiOperation({})
  async register(@Body() user: RegisterDto) {
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
