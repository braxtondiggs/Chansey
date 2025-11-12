import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
  HttpException,
  Req,
  Logger
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { FastifyReply, FastifyRequest } from 'fastify';

import { AuthenticationService } from './authentication.service';
import {
  ForgotPasswordDto,
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
import { RefreshTokenService } from './refresh-token.service';

import GetUser from '../authentication/decorator/get-user.decorator';
import { CreateUserDto } from '../users/dto/create-user.dto';
import { User } from '../users/users.entity';
import { AuthThrottle } from '../utils/decorators/throttle.decorator';

@ApiTags('Authentication')
@Controller('auth')
export class AuthenticationController {
  private readonly logger = new Logger(AuthenticationController.name);

  constructor(
    private readonly authentication: AuthenticationService,
    private readonly refreshTokenService: RefreshTokenService
  ) {}

  @Post('register')
  @AuthThrottle()
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
  @AuthThrottle()
  @ApiOperation({
    summary: 'Login to the application',
    description: 'Authenticates a user using email and password.'
  })
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

    // Generate new secure tokens
    const accessToken = await this.refreshTokenService.generateAccessToken((user as any).user);
    const refreshToken = await this.refreshTokenService.generateRefreshToken((user as any).user, rememberMe);

    // Set secure HttpOnly cookies with appropriate expiration
    const cookies = this.refreshTokenService.getCookieWithTokens(accessToken, refreshToken, rememberMe);
    cookies.forEach((cookie) => response.header('Set-Cookie', cookie));

    // Return user data with remember me preference
    return response.send({
      ...user,
      rememberMe: rememberMe
    });
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
    // Clear the new secure cookies
    const cookies = this.refreshTokenService.getCookiesForLogOut();
    cookies.forEach((cookie) => response.header('Set-Cookie', cookie));

    // Also clear old cookies for backwards compatibility
    response
      .clearCookie('Authentication')
      .clearCookie('Refresh')
      .clearCookie('chansey_auth')
      .status(HttpStatus.OK)
      .send(new LogoutResponseDto('Logout successful'));

    // Call external auth service logout
    try {
      const { errors } = await this.authentication.auth.logout();
      if (errors && errors.length) {
        this.logger.warn(`External auth logout warning: ${errors[0]}`);
      }
    } catch (error) {
      this.logger.warn(`External auth logout failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  @Post('change-password')
  @AuthThrottle()
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
  @AuthThrottle()
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
  @AuthThrottle()
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
  @AuthThrottle()
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
    const authResult = await this.authentication.verifyOtp(verifyOtpDto);

    if (authResult.user && authResult.access_token) {
      // Create user object for token generation
      const user = {
        id: authResult.user.id,
        email: authResult.user.email,
        given_name: authResult.user.given_name,
        family_name: authResult.user.family_name
      } as User;

      const rememberMe = false; // OTP usually doesn't have remember me context

      // Generate new secure tokens
      const accessToken = await this.refreshTokenService.generateAccessToken(user);
      const refreshToken = await this.refreshTokenService.generateRefreshToken(user, rememberMe);

      // Set secure HttpOnly cookies
      const cookies = this.refreshTokenService.getCookieWithTokens(accessToken, refreshToken, rememberMe);
      cookies.forEach((cookie) => response.header('Set-Cookie', cookie));
    }

    return response.send(authResult);
  }

  @Post('resend-otp')
  @AuthThrottle()
  @ApiOperation({
    summary: 'Resend OTP',
    description: 'Resend the one-time password (OTP) code to the user'
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

  @Post('refresh')
  @AuthThrottle()
  @ApiOperation({
    summary: 'Refresh Access Token',
    description: 'Refreshes the access token using a valid refresh token'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tokens refreshed successfully'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'Invalid refresh token'
  })
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Req() req: FastifyRequest, @Res() response: FastifyReply) {
    const refreshToken = req.cookies['chansey_refresh'];

    if (!refreshToken) {
      throw new HttpException('Refresh token not found', HttpStatus.UNAUTHORIZED);
    }

    const {
      accessToken,
      refreshToken: newRefreshToken,
      rememberMe
    } = await this.refreshTokenService.refreshAccessToken(refreshToken);
    const cookies = this.refreshTokenService.getCookieWithTokens(accessToken, newRefreshToken, rememberMe);

    cookies.forEach((cookie) => response.header('Set-Cookie', cookie));

    return response.send({
      message: 'Tokens refreshed successfully',
      access_token: accessToken
    });
  }
}
