import { inject, Injectable } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

import { Observable } from 'rxjs';

import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class ReverseAuthGuard {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  canActivate(): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    return this.auth.isAuthenticated().then((isAuthenticated) => {
      if (!isAuthenticated) return true;

      // If authenticated, redirect to dashboard
      return this.router.createUrlTree(['/app/dashboard']);
    });
  }
}
