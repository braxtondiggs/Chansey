import { User } from '../../users/users.entity';

/**
 * Result returned from authentication operations that provide user data
 */
export interface AuthResult {
  user: User;
  access_token: string | null;
  message?: string;
}

/**
 * Result returned when OTP verification is required
 */
export interface OtpRequiredResult {
  should_show_email_otp_screen: boolean;
  message: string;
}

/**
 * Union type for all possible authentication results
 */
export type AuthenticationResult = AuthResult | OtpRequiredResult;

/**
 * Type guard to check if result requires OTP
 */
export function isOtpRequired(result: AuthenticationResult): result is OtpRequiredResult {
  return 'should_show_email_otp_screen' in result;
}
