import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject } from '@angular/core';
import { RouterModule } from '@angular/router';

import { LayoutService } from '@chansey-web/app/shared/services/layout.service';

import { AppMenu } from './app.menu';
import { AppTopBar } from './app.topbar';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, AppMenu, RouterModule, AppTopBar],
  template: `<div class="layout-sidebar" (mouseenter)="onMouseEnter()" (mouseleave)="onMouseLeave()">
    <div class="sidebar-header">
      <a class="logo flex items-center" [routerLink]="['/app/dashboard']">
        <img class="logo-image" src="/public/icon.png" alt="Cymbit Trading Logo" />
        <span class="app-name title-h7">Cymbit Trading</span>
      </a>
      <button class="layout-sidebar-anchor z-2" type="button" (click)="anchor()"></button>
    </div>

    <div #menuContainer class="layout-menu-container">
      <app-menu></app-menu>
    </div>
    <app-topbar *ngIf="isHorizontal()"></app-topbar>
  </div>`
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppSidebar {
  private readonly layoutService = inject(LayoutService);
  private readonly el = inject(ElementRef);
  isHorizontal = computed(() => this.layoutService.isHorizontal());
  timeout: ReturnType<typeof setTimeout> | null = null;

  @ViewChild('menuContainer') menuContainer!: ElementRef;

  onMouseEnter() {
    if (!this.layoutService.layoutState().anchored) {
      if (this.timeout) {
        clearTimeout(this.timeout);
        this.timeout = null;
      }

      this.layoutService.layoutState.update((state) => {
        if (!state.sidebarActive) {
          return {
            ...state,
            sidebarActive: true
          };
        }
        return state;
      });
    }
  }

  onMouseLeave() {
    if (!this.layoutService.layoutState().anchored) {
      if (!this.timeout) {
        this.timeout = setTimeout(() => {
          this.layoutService.layoutState.update((state) => {
            if (state.sidebarActive) {
              return {
                ...state,
                sidebarActive: false
              };
            }
            return state;
          });
        }, 300);
      }
    }
  }

  anchor() {
    this.layoutService.layoutState.update((state) => ({
      ...state,
      anchored: !state.anchored
    }));
  }
}
