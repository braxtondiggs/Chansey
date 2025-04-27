export interface IVerifyOtpRequest {
  otp: string;
  email: string;
}

export interface IOtpResponse {
  success: boolean;
  message: string;
}
