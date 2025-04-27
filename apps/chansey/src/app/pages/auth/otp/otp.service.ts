import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { Observable } from 'rxjs';

import { IOtpResponse, IVerifyOtpRequest } from '@chansey/api-interfaces';

@Injectable({
  providedIn: 'root'
})
export class OtpService {
  constructor(private http: HttpClient) {}

  /**
   * Verify the OTP code
   * @param code The OTP code entered by the user
   * @returns An observable with the verification response
   */
  verifyOtp(otp: string, email: string): Observable<IOtpResponse> {
    const request: IVerifyOtpRequest = { otp, email };
    return this.http.post<IOtpResponse>('/api/auth/verify-otp', request, { withCredentials: true });
  }

  /**
   * Resend the OTP code to the user
   * @returns An observable with the response
   */
  resendOtp(): Observable<IOtpResponse> {
    return this.http.post<IOtpResponse>('/api/auth/resend-otp', {}, { withCredentials: true });
  }
}
