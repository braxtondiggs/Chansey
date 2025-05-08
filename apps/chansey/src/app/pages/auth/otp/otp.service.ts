import { Injectable } from '@angular/core';

import { ILoginResponse, IOtpResponse, IVerifyOtpRequest } from '@chansey/api-interfaces';

import { useAuthMutation } from '@chansey-web/app/core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class OtpService {
  useVerifyOtpMutation() {
    return useAuthMutation<ILoginResponse, IVerifyOtpRequest>('/api/auth/otp/verify', 'POST', {
      onSuccess: (response) => {
        if (response.access_token) {
          localStorage.setItem('token', response.access_token);
        }
      }
    });
  }

  useResendOtpMutation() {
    return useAuthMutation<IOtpResponse, { email: string }>('/api/auth/otp/resend', 'POST');
  }
}
