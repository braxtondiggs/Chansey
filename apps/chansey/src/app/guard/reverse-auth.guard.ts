import { inject, Injectable } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

import { Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { AuthService } from '../shared/services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class ReverseAuthGuard {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  canActivate(): Observable<boolean | UrlTree> {
    return this.auth.isAuthenticated().pipe(
      map((isAuthenticated: boolean) => {
        if (!isAuthenticated) {
          return true;
        }
        // If authenticated, redirect to dashboard
        return this.router.createUrlTree(['/app/dashboard']);
      }),
      catchError(() => {
        // On any error, allow access (assume not authenticated)
        return [true];
      })
    );
  }
}
