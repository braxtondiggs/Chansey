export interface IVerifyOtpRequest {
  otp: string;
  email: string;
  rememberMe?: boolean;
}

export interface IOtpResponse {
  success: boolean;
  message: string;
}

export interface OtpResponse {
  message: string;
}
