import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AuthService } from '@chansey-web/app/shared/services/auth.service';

import { AppMenuitem } from './app.menuitem';

interface MenuItem {
  label?: string;
  icon?: string;
  routerLink?: string[];
  items?: MenuItem[];
  separator?: boolean;
}

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [AppMenuitem, RouterModule],
  template: `<ul class="layout-menu">
    @for (item of model(); track item; let i = $index) {
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
export class AppMenu implements OnInit {
  private readonly authService = inject(AuthService);
  user = this.authService.useUser();
  isAdmin = computed(() => this.user.data()?.roles?.includes('admin'));
  model = signal<MenuItem[]>([]);

  constructor() {
    effect(() => {
      this.updateMenu();
    });
  }

  ngOnInit() {
    this.updateMenu();
  }

  private updateMenu(): void {
    const menuItems = [
      {
        label: 'Portfolio Hub',
        icon: 'pi pi-fw pi-briefcase',
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
            label: 'Backtesting',
            icon: 'pi pi-fw pi-chart-line',
            routerLink: ['/app/backtesting']
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
          }
        ]
      },
      {
        separator: true
      }
    ];

    if (this.isAdmin()) {
      menuItems.push({
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
          }
        ]
      });
    }

    this.model.set(menuItems);
  }
}
