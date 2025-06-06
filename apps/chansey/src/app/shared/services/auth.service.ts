import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/angular-query-experimental';

import { ILogoutResponse, IUser } from '@chansey/api-interfaces';

import { useAuthMutation, useAuthQuery, createQueryKeys } from '@chansey-web/app/core/query/query.utils';

// Define auth query keys
export const authKeys = createQueryKeys<{
  all: string[];
  user: string[];
  token: string[];
}>('auth');

authKeys.user = [...authKeys.all, 'user'];
authKeys.token = [...authKeys.all, 'token'];

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly router = inject(Router);
  private readonly queryClient = inject(QueryClient);

  useUser() {
    return useAuthQuery<IUser>(authKeys.user, '/api/user');
  }

  useLogoutMutation() {
    return useAuthMutation<ILogoutResponse, void>('/api/auth/logout', 'POST', {
      onSuccess: () => {
        // Clear the authentication token
        localStorage.removeItem('token');

        // Clear all TanStack Query cache to ensure no stale data
        this.queryClient.clear();

        // Navigate to login page
        this.router.navigate(['/login']);
      },
      invalidateQueries: []
    });
  }

  isAuthenticated(): Promise<boolean> {
    return Promise.resolve(Boolean(this.getToken()));
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }
}
