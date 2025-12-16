import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/angular-query-experimental';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { ILogoutResponse, IUser } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation, useAuthQuery, STANDARD_POLICY } from '@chansey/shared';

import { environment } from '../../../environments/environment';

/**
 * Service for authentication via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly router = inject(Router);
  private readonly queryClient = inject(QueryClient);
  private readonly http = inject(HttpClient);

  /**
   * Query current user data
   */
  useUser() {
    return useAuthQuery<IUser>(queryKeys.auth.user(), '/api/user', {
      cachePolicy: STANDARD_POLICY
    });
  }

  /**
   * Logout mutation
   */
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
        if (environment.production) {
          this.logout();
        }
        return of(false);
      })
    );
  }

  /**
   * Checks if user is authenticated by checking the TanStack Query cache
   * Falls back to making a request if no cached data exists
   */
  isAuthenticated(): Observable<boolean> {
    // First check if we have cached user data
    const cachedUser = this.queryClient.getQueryData<IUser>(queryKeys.auth.user());
    if (cachedUser) {
      return of(true);
    }

    // If no cache, make a request and update cache
    return this.http.get<IUser>('/api/user', { withCredentials: true }).pipe(
      map((user) => {
        // Cache the user data in TanStack Query
        this.queryClient.setQueryData(queryKeys.auth.user(), user);
        return true;
      }),
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
