import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/query-core';

import { ILogin, ILoginResponse } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation } from '@chansey/shared';

@Injectable({
  providedIn: 'root'
})
export class LoginService {
  private readonly queryClient = inject(QueryClient);
  private readonly router = inject(Router);

  useLogin() {
    return useAuthMutation<ILoginResponse, ILogin>('/api/auth/login', 'POST', {
      onSuccess: (response, variables) => {
        if (response.should_show_email_otp_screen) {
          sessionStorage.setItem('otpEmail', variables.email);
          this.router.navigate(['/auth/otp']);
          return;
        }

        this.queryClient.setQueryData(queryKeys.auth.user(), response.user);
      },
      invalidateQueries: [queryKeys.auth.user()]
    });
  }
}
