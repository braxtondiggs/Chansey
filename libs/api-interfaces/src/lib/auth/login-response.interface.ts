import { IUser } from './user.interface';

export interface ILoginResponse {
  message: string;
  access_token: string;
  expires_in: number;
  refresh_token: string | null;
  id_token: string;
  should_show_email_otp_screen: boolean | null;
  should_show_mobile_otp_screen: boolean | null;
  should_show_totp_screen: boolean | null;
  authenticator_scanner_image: string | null;
  authenticator_secret: string | null;
  authenticator_recovery_codes: string[] | null;
  user: IUser;
}
