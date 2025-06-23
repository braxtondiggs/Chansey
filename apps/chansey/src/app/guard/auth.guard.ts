import { inject, Injectable } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

import { Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

import { AuthService } from '@chansey-web/app/shared/services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AuthGuard {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  canActivate(): Observable<boolean | UrlTree> {
    return this.auth.isAuthenticated().pipe(
      map((isAuthenticated) => {
        if (isAuthenticated) {
          return true;
        }
        return this.router.createUrlTree(['/login']);
      }),
      catchError(() => {
        // On any error, redirect to login
        return [this.router.createUrlTree(['/login'])];
      })
    );
  }
}
