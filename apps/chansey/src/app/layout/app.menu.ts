import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AppMenuitem } from './app.menuitem';

import { AuthService } from '../services/auth.service';

@Component({
  selector: 'app-menu',
  standalone: true,
  imports: [CommonModule, AppMenuitem, RouterModule],
  template: `<ul class="layout-menu">
    <ng-container *ngFor="let item of model; let i = index">
      <li chansey-menuitem *ngIf="!item.separator" [item]="item" [index]="i" [root]="true"></li>
      <li *ngIf="item.separator" class="menu-separator"></li>
    </ng-container>
  </ul> `
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppMenu implements OnInit {
  model: any[] = [];
  isAdmin = false;

  constructor(private authService: AuthService) {}

  ngOnInit() {
    this.authService.user$.subscribe((user) => {
      this.isAdmin = user?.roles?.includes('admin') || false;
      this.updateMenu();
    });
  }

  private updateMenu() {
    this.model = [];

    if (this.isAdmin) {
      this.model.push({
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
          }
        ]
      });
    }
  }
}
