import { Injectable } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

import { Observable, map } from 'rxjs';

import { AuthService } from '../services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard {
  constructor(
    private auth: AuthService,
    private router: Router
  ) {}

  canActivate(): Observable<boolean | UrlTree> | Promise<boolean | UrlTree> | boolean | UrlTree {
    return this.auth.user$.pipe(
      map((user) => {
        if (user && user.roles && user.roles.includes('admin')) {
          return true;
        }
        return this.router.createUrlTree(['/app/dashboard']);
      })
    );
  }
}
