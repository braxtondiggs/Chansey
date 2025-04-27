import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards, HttpException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { FastifyReply } from 'fastify';

import { AuthenticationService } from './authentication.service';
import {
  ForgotPasswordDto,
  LogInDto,
  LoginResponseDto,
  LogoutResponseDto,
  OtpResponseDto,
  RegisterResponseDto,
  ResetPasswordDto,
  ResetPasswordResponseDto,
  VerifyOtpDto,
  ChangePasswordDto,
  ChangePasswordResponseDto
} from './dto';
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
  async logOut(@Res() response: FastifyReply) {
    response
      .header('Set-Cookie', this.authentication.getCookieForLogOut())
      .clearCookie('Authentication')
      .clearCookie('Refresh')
      .status(HttpStatus.OK)
      .send(new LogoutResponseDto('Logout successful'));
    const { data, errors } = await this.authentication.auth.logout();
    if (errors && errors.length) {
      throw new HttpException(errors[0], HttpStatus.BAD_REQUEST);
    }
    return data;
  }

  @Post('change-password')
  @ApiOperation({
    summary: 'Change user password',
    description: 'Allows authenticated users to change their password'
  })
  @ApiBody({ type: ChangePasswordDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password changed successfully',
    type: ChangePasswordResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid current password or new password requirements not met'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @HttpCode(HttpStatus.OK)
  async changePassword(@GetUser() user: User, @Body() changePasswordDto: ChangePasswordDto) {
    return this.authentication.changePassword(user, changePasswordDto);
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

  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset Password',
    description: 'Resets user password using the provided token.'
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Password reset successful.',
    type: ResetPasswordResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid token or password.'
  })
  async resetPassword(@Body() resetPasswordData: ResetPasswordDto) {
    const { data, errors } = await this.authentication.auth.resetPassword({
      token: resetPasswordData.token,
      password: resetPasswordData.password,
      confirm_password: resetPasswordData.confirm_password
    });

    if (errors && errors.length) {
      throw new HttpException(errors[0], HttpStatus.BAD_REQUEST);
    }

    return data || new ResetPasswordResponseDto();
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: 'Verify OTP',
    description: 'Verifies the one-time password (OTP) code entered by the user'
  })
  @ApiBody({ type: VerifyOtpDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'OTP verified successfully',
    type: OtpResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid OTP code'
  })
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() verifyOtpDto: VerifyOtpDto, @Res() response: FastifyReply) {
    const user = await this.authentication.verifyOtp(verifyOtpDto);
    if (user.id_token) {
      const cookie = this.authentication.getCookieWithJwtToken(user.id_token, user.expires_in);
      response.header('Set-Cookie', cookie);
    }
    return response.send(user);
  }

  @Post('resend-otp')
  @ApiOperation({
    summary: 'Resend OTP',
    description: 'Resends the one-time password (OTP) code to the user'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'OTP resent successfully',
    type: OtpResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Failed to resend OTP'
  })
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() { email }: { email: string }) {
    const result = await this.authentication.resendOtp(email);
    return new OtpResponseDto(result.message);
  }
}
