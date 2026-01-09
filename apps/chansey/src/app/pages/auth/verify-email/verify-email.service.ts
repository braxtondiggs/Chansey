import { Injectable } from '@angular/core';

import { useAuthMutation } from '@chansey/shared';

export interface VerifyEmailResponse {
  message: string;
}

export interface VerifyEmailRequest {
  token: string;
}

@Injectable({
  providedIn: 'root'
})
export class VerifyEmailService {
  useVerifyEmailMutation() {
    return useAuthMutation<VerifyEmailResponse, VerifyEmailRequest>('/api/auth/verify-email', 'POST');
  }
}
