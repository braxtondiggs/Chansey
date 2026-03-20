import { CommonModule } from '@angular/common';
import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterModule } from '@angular/router';

import { BehaviorSubject, filter } from 'rxjs';

import { LayoutService } from '../shared/services/layout.service';

interface Breadcrumb {
  label: string;
  url?: string;
}

const FROM_MAP: Record<string, { label: string; url: string }> = {
  prices: { label: 'Prices', url: '/app/prices' },
  watchlist: { label: 'Watchlist', url: '/app/watchlist' },
  portfolio: { label: 'Portfolio', url: '/app/dashboard' },
  transactions: { label: 'Transactions', url: '/app/transactions' }
};

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `@if (!hideBreadcrumb()) {
    <nav class="layout-breadcrumb">
      <ol>
        @for (item of breadcrumbs$ | async; track item.label; let last = $last) {
          <li class="title-h7 text-xl text-surface-950 dark:text-surface-0">
            @if (!last && item.url) {
              <a [routerLink]="item.url" class="breadcrumb-link">{{ item.label }}</a>
            } @else {
              {{ item.label }}
            }
          </li>
          @if (!last) {
            <li class="layout-breadcrumb-chevron">/</li>
          }
        }
      </ol>
    </nav>
  }`
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppBreadcrumb implements OnInit {
  private readonly _breadcrumbs$ = new BehaviorSubject<Breadcrumb[]>([]);

  readonly breadcrumbs$ = this._breadcrumbs$.asObservable();

  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly layoutService = inject(LayoutService);

  readonly hideBreadcrumb = this.layoutService.hideBreadcrumb;

  ngOnInit(): void {
    // Build breadcrumbs from current route (handles page refresh)
    const root = this.router.routerState.snapshot.root;
    const breadcrumbs: Breadcrumb[] = [];
    this.addBreadcrumb(root, [], breadcrumbs);
    this._breadcrumbs$.next(breadcrumbs);

    // Continue listening for future navigations
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => {
        const root = this.router.routerState.snapshot.root;
        const breadcrumbs: Breadcrumb[] = [];
        this.addBreadcrumb(root, [], breadcrumbs);
        this._breadcrumbs$.next(breadcrumbs);
      });
  }

  private addBreadcrumb(route: ActivatedRouteSnapshot, parentUrl: string[], breadcrumbs: Breadcrumb[]) {
    const routeUrl = parentUrl.concat(route.url.map((url) => url.path));
    const breadcrumb = route.data['breadcrumb'];
    const parentBreadcrumb = route.parent && route.parent.data ? route.parent.data['breadcrumb'] : null;

    if (breadcrumb && breadcrumb !== parentBreadcrumb) {
      // Inject a parent breadcrumb from ?from= query param (e.g., "Prices / Bitcoin")
      const from = route.queryParamMap.get('from');
      if (from && FROM_MAP[from]) {
        breadcrumbs.push(FROM_MAP[from]);
      }

      let label: string = breadcrumb;
      if (typeof breadcrumb === 'function') {
        label = breadcrumb(route);
      }
      breadcrumbs.push({
        label,
        url: '/' + routeUrl.join('/')
      });
    }

    if (route.firstChild) {
      this.addBreadcrumb(route.firstChild, routeUrl, breadcrumbs);
    }
  }
}
