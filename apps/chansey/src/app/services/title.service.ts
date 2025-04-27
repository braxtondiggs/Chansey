import { Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute, NavigationEnd, Router } from '@angular/router';

import { filter, map, mergeMap } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class TitleService {
  private readonly APP_NAME = 'Cymbit Trading';

  constructor(
    private titleService: Title,
    private router: Router,
    private activatedRoute: ActivatedRoute
  ) {}

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
        mergeMap((route) => route.data)
      )
      .subscribe((event) => {
        if (event['breadcrumb']) {
          this.titleService.setTitle(`${event['breadcrumb']} » ${this.APP_NAME}`);
        } else {
          this.titleService.setTitle(this.APP_NAME);
        }
      });
  }

  setTitle(title: string) {
    this.titleService.setTitle(`${title} » ${this.APP_NAME}`);
  }
}
