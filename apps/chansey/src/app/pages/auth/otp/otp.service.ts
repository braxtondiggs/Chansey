import { Injectable } from '@angular/core';

import { ILoginResponse, IOtpResponse, IVerifyOtpRequest } from '@chansey/api-interfaces';

import { useAuthMutation } from '@chansey-web/app/core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class OtpService {
  useVerifyOtpMutation() {
    return useAuthMutation<ILoginResponse, IVerifyOtpRequest>('/api/auth/verify-otp', 'POST');
  }

  useResendOtpMutation() {
    return useAuthMutation<IOtpResponse, { email: string }>('/api/auth/otp/resend', 'POST');
  }
}
