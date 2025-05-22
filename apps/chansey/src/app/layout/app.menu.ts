import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AppMenuitem } from './app.menuitem';

import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [CommonModule, AppMenuitem, RouterModule],
  template: `<ul class="layout-menu">
    <ng-container *ngFor="let item of model(); let i = index">
      <li chansey-menuitem *ngIf="!item.separator" [item]="item" [index]="i" [root]="true"></li>
      <li *ngIf="item.separator" class="menu-separator"></li>
    </ng-container>
  </ul> `
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppMenu implements OnInit {
  private readonly authService = inject(AuthService);
  user = this.authService.useUser();
  isAdmin = computed(() => this.user.data()?.roles?.includes('admin'));
  model = signal<any[]>([]);

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
            label: 'Prices',
            icon: 'pi pi-fw pi-money-bill',
            routerLink: ['/app/prices']
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
