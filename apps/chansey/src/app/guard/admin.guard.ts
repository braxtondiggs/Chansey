import { Injectable, inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';

import { QueryClient } from '@tanstack/query-core';

import { IUser } from '@chansey/api-interfaces';

import { authenticatedFetch } from '@chansey-web/app/core/query';
import { authKeys } from '@chansey-web/app/shared/services';

@Injectable({
  providedIn: 'root'
})
export class AdminGuard {
  private readonly router = inject(Router);
  private readonly queryClient = inject(QueryClient);

  async canActivate(): Promise<boolean | UrlTree> {
    const user = await this.queryClient.ensureQueryData({
      queryKey: authKeys.user,
      queryFn: () => authenticatedFetch<IUser>('/api/user')
    });

    if (user?.roles.includes('admin')) return true;
    return this.router.createUrlTree(['/app/dashboard']);
  }
}
