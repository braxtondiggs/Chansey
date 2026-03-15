import { inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';

import { filter, map, mergeMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class TitleService {
  private readonly APP_NAME = 'Cymbit Trading';
  private readonly titleService = inject(Title);
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  init() {
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        map(() => this.activatedRoute),
        map((route) => {
          while (route.firstChild) {
            route = route.firstChild;
          }
          return route;
        }),
        filter((route) => route.outlet === 'primary'),
        mergeMap((route) => route.data.pipe(map((data) => ({ data, snapshot: route.snapshot }))))
      )
      .subscribe(({ data, snapshot }) => {
        const breadcrumb = data['breadcrumb'];
        if (breadcrumb) {
          const label = typeof breadcrumb === 'function' ? breadcrumb(snapshot) : breadcrumb;
          this.titleService.setTitle(`${label} » ${this.APP_NAME}`);
        } else {
          this.titleService.setTitle(this.APP_NAME);
        }
      });
  }

  setTitle(title: string) {
    this.titleService.setTitle(`${title} » ${this.APP_NAME}`);
  }
}
