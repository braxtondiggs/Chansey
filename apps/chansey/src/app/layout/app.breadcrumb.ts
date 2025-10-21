import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterModule } from '@angular/router';

import { BehaviorSubject, filter } from 'rxjs';

interface Breadcrumb {
  label: string;
  url?: string;
}

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [CommonModule, RouterModule],
  template: `<nav class="layout-breadcrumb">
    <ol>
      @for (item of breadcrumbs$ | async; track item; let last = $last) {
        <li class="text-surface-950 dark:text-surface-0 title-h7 text-xl">{{ item.label }}</li>
        @if (!last) {
          <li class="layout-breadcrumb-chevron">/</li>
        }
      }
    </ol>
  </nav>`
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppBreadcrumb implements OnInit {
  private readonly _breadcrumbs$ = new BehaviorSubject<Breadcrumb[]>([]);

  readonly breadcrumbs$ = this._breadcrumbs$.asObservable();

  private readonly router = inject(Router);

  ngOnInit(): void {
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
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
      breadcrumbs.push({
        label: route.data['breadcrumb'],
        url: '/' + routeUrl.join('/')
      });
    }

    if (route.firstChild) {
      this.addBreadcrumb(route.firstChild, routeUrl, breadcrumbs);
    }
  }
}
