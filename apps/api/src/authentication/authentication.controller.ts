import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
  UseGuards
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { FastifyReply, FastifyRequest } from 'fastify';

import { AuthenticationService } from './authentication.service';
import {
  AuthenticationResult,
  ChangePasswordDto,
  ChangePasswordResponseDto,
  DisableOtpDto,
  DisableOtpResponseDto,
  EnableOtpResponseDto,
  ForgotPasswordDto,
  isOtpRequired,
  LoginResponseDto,
  LogoutResponseDto,
  OtpResponseDto,
  RegisterResponseDto,
  ResendEmailDto,
  ResendEmailResponseDto,
  ResetPasswordDto,
  ResetPasswordResponseDto,
  VerifyEmailDto,
  VerifyEmailResponseDto,
  VerifyOtpDto
} from './dto';
import { JwtAuthenticationGuard } from './guard/jwt-authentication.guard';
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
    description: 'Registers a new user with the provided details. A verification email will be sent.'
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'The user has been successfully registered. Verification email sent.',
    type: RegisterResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data.'
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'User with this email already exists.'
  })
  async register(@Body() user: CreateUserDto) {
    return this.authentication.register(user);
  }

  @Post('verify-email')
  @AuthThrottle()
  @ApiOperation({
    summary: 'Verify email address',
    description: 'Verifies user email using the token from the verification email'
  })
  @ApiBody({ type: VerifyEmailDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Email verified successfully',
    type: VerifyEmailResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid or expired verification token'
  })
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authentication.verifyEmail(verifyEmailDto.token);
  }

  @Post('resend-verification')
  @AuthThrottle()
  @ApiOperation({
    summary: 'Resend verification email',
    description: 'Resends the email verification link to the specified email address'
  })
  @ApiBody({ type: ResendEmailDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Verification email sent if account exists',
    type: ResendEmailResponseDto
  })
  @HttpCode(HttpStatus.OK)
  async resendVerification(@Body() resendEmailDto: ResendEmailDto) {
    return this.authentication.resendVerificationEmail(resendEmailDto.email);
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
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Email not verified.'
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Account locked due to too many failed attempts.'
  })
  @HttpCode(HttpStatus.OK)
  @UseGuards(LocalAuthenticationGuard)
  async logIn(@GetUser() authResult: AuthenticationResult, @Res() response: FastifyReply) {
    if (isOtpRequired(authResult)) {
      return response.send(authResult);
    }

    const userData = authResult.user;
    const rememberMe = userData.rememberMe || false;

    // Generate new secure tokens
    const accessToken = await this.refreshTokenService.generateAccessToken(userData);
    const refreshToken = await this.refreshTokenService.generateRefreshToken(userData, rememberMe);

    // Set secure HttpOnly cookies with appropriate expiration
    const cookies = this.refreshTokenService.getCookieWithTokens(accessToken, refreshToken, rememberMe);
    cookies.forEach((cookie) => response.header('Set-Cookie', cookie));

    // Return user data with remember me preference
    return response.send({
      user: userData,
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
  async logOut(@Res() response: FastifyReply) {
    // Clear the secure cookies
    const cookies = this.refreshTokenService.getCookiesForLogOut();
    cookies.forEach((cookie) => response.header('Set-Cookie', cookie));

    // Also clear old cookies for backwards compatibility
    response
      .clearCookie('Authentication')
      .clearCookie('Refresh')
      .clearCookie('chansey_auth')
      .status(HttpStatus.OK)
      .send(new LogoutResponseDto('Logout successful'));
  }

  @Post('change-password')
  @AuthThrottle()
  @UseGuards(JwtAuthenticationGuard)
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
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() { email }: ForgotPasswordDto) {
    return this.authentication.forgotPassword(email);
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
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordData: ResetPasswordDto) {
    return this.authentication.resetPassword(
      resetPasswordData.token,
      resetPasswordData.password,
      resetPasswordData.confirm_password
    );
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

    if (authResult.user) {
      // Create user object for token generation
      const user = {
        id: authResult.user.id,
        email: authResult.user.email,
        given_name: authResult.user.given_name,
        family_name: authResult.user.family_name,
        roles: authResult.user.roles
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
  @ApiBody({ type: ResendEmailDto })
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
  async resendOtp(@Body() resendEmailDto: ResendEmailDto) {
    const result = await this.authentication.resendOtp(resendEmailDto.email);
    return new OtpResponseDto(result.message);
  }

  @Post('enable-otp')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Enable OTP/2FA',
    description: 'Enables email-based OTP for the authenticated user'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'OTP enabled successfully',
    type: EnableOtpResponseDto
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @HttpCode(HttpStatus.OK)
  async enableOtp(@GetUser() user: User) {
    return this.authentication.enableOtp(user.id);
  }

  @Post('disable-otp')
  @UseGuards(JwtAuthenticationGuard)
  @ApiOperation({
    summary: 'Disable OTP/2FA',
    description: 'Disables email-based OTP for the authenticated user. Requires password confirmation.'
  })
  @ApiBody({ type: DisableOtpDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'OTP disabled successfully',
    type: DisableOtpResponseDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid password'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @HttpCode(HttpStatus.OK)
  async disableOtp(@GetUser() user: User, @Body() disableOtpDto: DisableOtpDto) {
    return this.authentication.disableOtp(user.id, disableOtpDto.password);
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
