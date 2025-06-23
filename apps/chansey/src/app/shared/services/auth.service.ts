import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/angular-query-experimental';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

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
  private readonly http = inject(HttpClient);

  useUser() {
    return useAuthQuery<IUser>(authKeys.user, '/api/user');
  }

  useLogoutMutation() {
    return useAuthMutation<ILogoutResponse, void>('/api/auth/logout', 'POST', {
      onSuccess: () => {
        // Clear all TanStack Query cache to ensure no stale data
        this.queryClient.clear();

        // Navigate to login page
        this.router.navigate(['/login']);
      },
      invalidateQueries: []
    });
  }

  /**
   * Attempts to refresh the access token using the refresh token stored in HttpOnly cookie
   */
  refreshToken(): Observable<boolean> {
    return this.http.post('/api/auth/refresh', {}, { withCredentials: true }).pipe(
      map(() => true),
      catchError((error) => {
        console.error('Token refresh failed:', error);
        this.logout();
        return of(false);
      })
    );
  }

  /**
   * Checks if user is authenticated by making a request to a protected endpoint
   * This relies on the HttpOnly cookie authentication
   */
  isAuthenticated(): Observable<boolean> {
    return this.http.get('/api/user', { withCredentials: true }).pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  /**
   * Logout and clear session
   */
  logout(): void {
    this.queryClient.clear();
    this.router.navigate(['/login']);
  }
}
