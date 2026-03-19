import { Component, computed, inject } from '@angular/core';
import { IsActiveMatchOptions, RouterModule } from '@angular/router';

import { Role } from '@chansey/api-interfaces';

import { AppMenuitem } from './app.menuitem';

import { AuthService } from '../shared/services/auth.service';

export interface MenuItem {
  label?: string;
  icon?: string;
  routerLink?: string[];
  items?: MenuItem[];
  separator?: boolean;
  visible?: boolean;
  url?: string;
  class?: string;
  target?: string;
  fragment?: string;
  queryParamsHandling?: 'merge' | 'preserve' | '';
  preserveFragment?: boolean;
  skipLocationChange?: boolean;
  replaceUrl?: boolean;
  state?: Record<string, unknown>;
  queryParams?: Record<string, string>;
  routerLinkActiveOptions?: { exact: boolean } | IsActiveMatchOptions;
  disabled?: boolean;
  command?: (args: { originalEvent: Event; item: MenuItem }) => void;
  badgeClass?: string;
}

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [AppMenuitem, RouterModule],
  template: `<ul class="layout-menu">
    @for (item of model(); track $index; let i = $index) {
      @if (!item.separator) {
        <li chansey-menuitem [item]="item" [index]="i" [root]="true"></li>
      }
      @if (item.separator) {
        <li class="menu-separator"></li>
      }
    }
  </ul>`
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppMenu {
  private readonly authService = inject(AuthService);
  user = this.authService.useUser();
  private readonly isAdmin = computed(() => this.user.data()?.roles?.includes(Role.ADMIN));

  model = computed<MenuItem[]>(() => {
    const items: MenuItem[] = [
      {
        label: 'Trading',
        icon: 'pi pi-fw pi-chart-line',
        items: [
          {
            label: 'Dashboard',
            icon: 'pi pi-fw pi-home',
            routerLink: ['/app/dashboard']
          },
          {
            label: 'Transactions',
            icon: 'pi pi-fw pi-arrow-right-arrow-left',
            routerLink: ['/app/transactions']
          },
          {
            label: 'Prices',
            icon: 'pi pi-fw pi-money-bill',
            routerLink: ['/app/prices']
          },
          {
            label: 'Watchlist',
            icon: 'pi pi-fw pi-star',
            routerLink: ['/app/watchlist']
          },
          {
            label: 'Trading Coins',
            icon: 'pi pi-fw pi-chart-bar',
            routerLink: ['/app/trading-coins']
          }
        ]
      },
      {
        separator: true
      }
    ];

    if (this.isAdmin()) {
      items.push({
        label: 'Admin',
        icon: 'pi pi-cog',
        items: [
          {
            label: 'Algorithms',
            icon: 'pi pi-fw pi-code',
            routerLink: ['/admin/algorithms']
          },
          {
            label: 'Categories',
            icon: 'pi pi-fw pi-tags',
            routerLink: ['/admin/categories']
          },
          {
            label: 'Coins',
            icon: 'pi pi-fw pi-bitcoin',
            routerLink: ['/admin/coins']
          },
          {
            label: 'Exchanges',
            icon: 'pi pi-fw pi-sync',
            routerLink: ['/admin/exchanges']
          },
          {
            label: 'Risk Levels',
            icon: 'pi pi-fw pi-exclamation-triangle',
            routerLink: ['/admin/risks']
          },
          {
            label: 'Bull Board',
            icon: 'pi pi-fw pi-server',
            routerLink: ['/admin/bull-board']
          },
          {
            label: 'Trading State',
            icon: 'pi pi-fw pi-power-off',
            routerLink: ['/admin/trading-state']
          },
          {
            label: 'Backtest Monitoring',
            icon: 'pi pi-fw pi-eye',
            routerLink: ['/admin/backtest-monitoring']
          },
          {
            label: 'Live Trade Monitoring',
            icon: 'pi pi-fw pi-chart-line',
            routerLink: ['/admin/live-trade-monitoring']
          }
        ]
      });
    }

    return items;
  });
}
