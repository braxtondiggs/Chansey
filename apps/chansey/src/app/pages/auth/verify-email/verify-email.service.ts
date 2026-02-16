import { Injectable } from '@angular/core';

import { VerifyEmailRequest, VerifyEmailResponse } from '@chansey/api-interfaces';
import { useAuthMutation } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class VerifyEmailService {
  useVerifyEmailMutation() {
    return useAuthMutation<VerifyEmailResponse, VerifyEmailRequest>('/api/auth/verify-email', 'POST');
  }
}
