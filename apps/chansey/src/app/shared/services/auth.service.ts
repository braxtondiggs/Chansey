import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import { QueryClient } from '@tanstack/angular-query-experimental';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';

import { ILogoutResponse, IUser } from '@chansey/api-interfaces';
import { STANDARD_POLICY, queryKeys, useAuthMutation, useAuthQuery } from '@chansey/shared';

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

  /** Timestamp of the last successful auth check */
  private lastAuthCheckTime = 0;
  /** How long a cached auth check is considered fresh (30 seconds) */
  private readonly AUTH_FRESHNESS_WINDOW = 30_000;

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
      onSuccess: async () => {
        // Cancel in-flight queries first to prevent 401 retries after logout
        await this.queryClient.cancelQueries();
        // Clear all TanStack Query cache to ensure no stale data
        this.queryClient.clear();
        this.lastAuthCheckTime = 0;
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
      catchError(() => of(false))
    );
  }

  /**
   * Checks if user is authenticated by checking the TanStack Query cache
   * Falls back to making a request if no cached data exists
   */
  isAuthenticated(): Observable<boolean> {
    const cachedUser = this.queryClient.getQueryData<IUser>(queryKeys.auth.user());
    const isFresh = Date.now() - this.lastAuthCheckTime < this.AUTH_FRESHNESS_WINDOW;

    // Trust the cache only if user exists AND the check is still fresh
    if (cachedUser && isFresh) {
      return of(true);
    }

    // Otherwise re-validate via HTTP; on 401 attempt a token refresh first
    return this.http.get<IUser>('/api/user', { withCredentials: true }).pipe(
      map((user) => {
        this.queryClient.setQueryData(queryKeys.auth.user(), user);
        this.lastAuthCheckTime = Date.now();
        return true;
      }),
      catchError((error: HttpErrorResponse) => {
        // Only attempt refresh on 401 (expired token); other errors mean not authenticated
        if (error.status !== 401) return of(false);

        return this.refreshToken().pipe(
          switchMap((refreshed) => {
            if (!refreshed) return of(false);
            return this.http.get<IUser>('/api/user', { withCredentials: true }).pipe(
              map((user) => {
                this.queryClient.setQueryData(queryKeys.auth.user(), user);
                this.lastAuthCheckTime = Date.now();
                return true;
              }),
              catchError(() => of(false))
            );
          })
        );
      })
    );
  }

  /**
   * Logout and clear session
   */
  async logout(): Promise<void> {
    await this.queryClient.cancelQueries();
    this.queryClient.clear();
    this.lastAuthCheckTime = 0;
    this.router.navigate(['/login']);
  }
}
