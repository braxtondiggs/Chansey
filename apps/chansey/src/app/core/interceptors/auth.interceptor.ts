import { HttpInterceptorFn, HttpErrorResponse, HttpEvent, HttpRequest, HttpHandlerFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

import { Observable, throwError, EMPTY } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { AuthService } from '../../shared/services/auth.service';

let isRefreshing = false;

export const AuthInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Add withCredentials to all requests to include HttpOnly cookies
  const secureReq = req.clone({
    // Ensure cookies are sent with requests
    withCredentials: true
  });

  return next(secureReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Handle 401 Unauthorized responses
      if (error.status === 401 && !isRefreshing) {
        return handle401Error(secureReq, next, authService, router);
      }

      return throwError(() => error);
    })
  );
};

function handle401Error(
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
  authService: AuthService,
  router: Router
): Observable<HttpEvent<unknown>> {
  // Prevent multiple concurrent refresh attempts
  if (isRefreshing) {
    return EMPTY;
  }

  isRefreshing = true;

  // Attempt to refresh the token
  return authService.refreshToken().pipe(
    switchMap((success: boolean) => {
      isRefreshing = false;

      if (success) {
        // Token refresh successful, retry the original request
        return next(req);
      } else {
        // Token refresh failed, redirect to login
        router.navigate(['/login']);
        return EMPTY;
      }
    }),
    catchError((error) => {
      isRefreshing = false;
      // Refresh failed, redirect to login
      router.navigate(['/login']);
      return throwError(() => error);
    })
  );
}
