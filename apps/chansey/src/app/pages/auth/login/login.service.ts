import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/query-core';

import { ILogin, ILoginResponse } from '@chansey/api-interfaces';

import { useAuthMutation } from '@chansey-web/app/core/query/query.utils';
import { authKeys } from '@chansey-web/app/services';

@Injectable({
  providedIn: 'root'
})
export class LoginService {
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  useLogin() {
    return useAuthMutation<ILoginResponse, ILogin>('/api/auth/login', 'POST', {
      onSuccess: (response) => {
        if (response.should_show_email_otp_screen) {
          sessionStorage.setItem('otpEmail', response.user.email);
          this.router.navigate(['/auth/otp']);
          return;
        }

        localStorage.setItem('token', response.access_token);
        this.queryClient.setQueryData(authKeys.user, response.user);
      },
      invalidateQueries: [authKeys.user]
    });
  }
}
