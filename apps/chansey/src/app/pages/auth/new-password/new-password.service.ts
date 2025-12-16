import { Injectable } from '@angular/core';

import { IResetPasswordResponse, IResetPassword } from '@chansey/api-interfaces';
import { useAuthMutation } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class NewPasswordService {
  useResetPasswordMutation() {
    return useAuthMutation<IResetPasswordResponse, IResetPassword>('/api/auth/reset-password', 'POST');
  }
}
