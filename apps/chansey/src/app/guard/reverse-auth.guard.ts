import { Injectable } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class ReverseAuthGuard {
  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    return this.auth.isAuthenticated().pipe(
      map((isAuth) => {
        // If not authenticated, allow access to auth pages
        if (!isAuth) return true;

        // If authenticated, redirect to dashboard
        return this.router.createUrlTree(['/app/dashboard']);
      })
    );
  }
}
