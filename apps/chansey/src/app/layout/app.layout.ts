import { CommonModule } from '@angular/common';
import { Component, OnDestroy, Renderer2, ViewChild, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { Subscription, filter } from 'rxjs';

import { LayoutService } from '@chansey-web/app/shared/services/layout.service';

import { AppBreadcrumb } from './app.breadcrumb';
import { AppConfigurator } from './app.configurator';
import { AppFooter } from './app.footer';
import { AppRightMenu } from './app.rightmenu';
import { AppSearch } from './app.search';
import { AppSidebar } from './app.sidebar';
import { AppTopBar } from './app.topbar';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    CommonModule,
    AppTopBar,
    AppSidebar,
    RouterModule,
    AppConfigurator,
    AppBreadcrumb,
    AppFooter,
    AppSearch,
    AppRightMenu
  ],
  template: `<div class="layout-wrapper" [ngClass]="containerClass()">
    <app-sidebar></app-sidebar>
    <div class="layout-content-wrapper">
      <div class="layout-content-wrapper-inside">
        <app-topbar></app-topbar>
        <div class="layout-content">
          <app-breadcrumb></app-breadcrumb>
          <router-outlet></router-outlet>
        </div>
        <app-footer></app-footer>
      </div>
    </div>
    <app-configurator />
    <app-search></app-search>
    <app-rightmenu></app-rightmenu>
    <div class="layout-mask animate-fadein"></div>
  </div> `
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppLayout implements OnDestroy {
  overlayMenuOpenSubscription: Subscription;

  menuOutsideClickListener: any;

  menuScrollListener: any;

  @ViewChild(AppSidebar) appSidebar!: AppSidebar;

  @ViewChild(AppTopBar) appTopBar!: AppTopBar;

  public layoutService: LayoutService = inject(LayoutService);
  public renderer: Renderer2 = inject(Renderer2);
  public router: Router = inject(Router);

  constructor() {
    this.overlayMenuOpenSubscription = this.layoutService.overlayOpen$.subscribe(() => {
      if (!this.menuOutsideClickListener) {
        this.menuOutsideClickListener = this.renderer.listen('document', 'click', (event) => {
          if (this.isOutsideClicked(event)) {
            this.hideMenu();
          }
        });
      }
      if (
        (this.layoutService.isHorizontal() || this.layoutService.isSlim() || this.layoutService.isCompact()) &&
        !this.menuScrollListener
      ) {
        this.menuScrollListener = this.renderer.listen(
          this.appSidebar.menuContainer.nativeElement,
          'scroll',
          (event) => {
            if (this.layoutService.isDesktop()) {
              this.hideMenu();
            }
          }
        );
      }
      if (this.layoutService.layoutState().staticMenuMobileActive) {
        this.blockBodyScroll();
      }
    });

    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => {
      this.hideMenu();
    });
  }

  isOutsideClicked(event: any) {
    const sidebarEl = document.querySelector('.layout-sidebar');
    const topbarButtonEl = document.querySelector('.menu-button');

    return !(
      sidebarEl?.isSameNode(event.target) ||
      sidebarEl?.contains(event.target) ||
      topbarButtonEl?.isSameNode(event.target) ||
      topbarButtonEl?.contains(event.target)
    );
  }

  hideMenu() {
    this.layoutService.layoutState.update((prev) => ({
      ...prev,
      overlayMenuActive: false,
      staticMenuMobileActive: false,
      menuHoverActive: false
    }));
    this.layoutService.reset();
    if (this.menuOutsideClickListener) {
      this.menuOutsideClickListener();
      this.menuOutsideClickListener = null;
    }

    if (this.menuScrollListener) {
      this.menuScrollListener();
      this.menuScrollListener = null;
    }

    this.unblockBodyScroll();
  }

  blockBodyScroll(): void {
    if (document.body.classList) {
      document.body.classList.add('blocked-scroll');
    } else {
      document.body.className += ' blocked-scroll';
    }
  }

  unblockBodyScroll(): void {
    if (document.body.classList) {
      document.body.classList.remove('blocked-scroll');
    } else {
      document.body.className = document.body.className.replace(
        new RegExp('(^|\\b)' + 'blocked-scroll'.split(' ').join('|') + '(\\b|$)', 'gi'),
        ' '
      );
    }
  }

  containerClass = computed(() => {
    const layoutConfig = this.layoutService.layoutConfig();
    const layoutState = this.layoutService.layoutState();

    return {
      'layout-overlay': layoutConfig.menuMode === 'overlay',
      'layout-static': layoutConfig.menuMode === 'static',
      'layout-slim': layoutConfig.menuMode === 'slim',
      'layout-horizontal': layoutConfig.menuMode === 'horizontal',
      'layout-compact': layoutConfig.menuMode === 'compact',
      'layout-reveal': layoutConfig.menuMode === 'reveal',
      'layout-drawer': layoutConfig.menuMode === 'drawer',
      'layout-overlay-active': layoutState.overlayMenuActive || layoutState.staticMenuMobileActive,
      'layout-mobile-active': layoutState.staticMenuMobileActive,
      'layout-static-inactive': layoutState.staticMenuDesktopInactive && layoutConfig.menuMode === 'static',
      'layout-sidebar-active': layoutState.sidebarActive,
      'layout-sidebar-anchored': layoutState.anchored,
      [`layout-card-${layoutConfig.cardStyle}`]: true,
      [`layout-sidebar-${layoutConfig.menuTheme}`]: true
    };
  });

  ngOnDestroy() {
    if (this.overlayMenuOpenSubscription) {
      this.overlayMenuOpenSubscription.unsubscribe();
    }

    if (this.menuOutsideClickListener) {
      this.menuOutsideClickListener();
    }
  }
}
