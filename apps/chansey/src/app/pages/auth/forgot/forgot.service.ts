import { Injectable } from '@angular/core';

import { IForgotPasswordResponse, IForgotPassword } from '@chansey/api-interfaces';
import { useAuthMutation } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class ForgotService {
  useForgotPasswordMutation() {
    return useAuthMutation<IForgotPasswordResponse, IForgotPassword>('/api/auth/forgot-password', 'POST');
  }
}
