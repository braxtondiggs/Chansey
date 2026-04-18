import { NgClass } from '@angular/common';
import { Component, computed, ElementRef, inject, OnDestroy, Renderer2, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { filter } from 'rxjs';

import { AppBreadcrumb } from './app.breadcrumb';
import { AppConfigurator } from './app.configurator';
import { AppFooter } from './app.footer';
import { AppRightMenu } from './app.rightmenu';
import { AppSearch } from './app.search';
import { AppSidebar } from './app.sidebar';
import { AppTopBar } from './app.topbar';

import { LayoutService } from '../shared/services/layout.service';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [
    AppTopBar,
    AppSidebar,
    RouterModule,
    AppConfigurator,
    AppBreadcrumb,
    AppFooter,
    AppSearch,
    AppRightMenu,
    NgClass
  ],
  template: `<div class="layout-wrapper" [ngClass]="containerClass()">
    <app-sidebar></app-sidebar>
    <div class="layout-content-wrapper" #contentWrapper>
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
  menuOutsideClickListener: (() => void) | null = null;

  menuScrollListener: (() => void) | null = null;

  readonly appSidebar = viewChild.required(AppSidebar);

  readonly appTopBar = viewChild.required(AppTopBar);

  readonly contentWrapper = viewChild.required<ElementRef<HTMLElement>>('contentWrapper');

  public layoutService: LayoutService = inject(LayoutService);
  private readonly renderer: Renderer2 = inject(Renderer2);
  private readonly router: Router = inject(Router);

  constructor() {
    this.layoutService.overlayOpen$.pipe(takeUntilDestroyed()).subscribe(() => {
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
          this.appSidebar().menuContainer().nativeElement,
          'scroll',
          () => {
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

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        this.hideMenu();
        this.contentWrapper().nativeElement.scrollTo(0, 0);
      });
  }

  isOutsideClicked(event: MouseEvent) {
    const sidebarEl = document.querySelector('.layout-sidebar');
    const topbarButtonEl = document.querySelector('.menu-button');
    const target = event.target as Node;

    return !(
      sidebarEl?.isSameNode(target) ||
      sidebarEl?.contains(target) ||
      topbarButtonEl?.isSameNode(target) ||
      topbarButtonEl?.contains(target)
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
    document.body.classList.add('blocked-scroll');
  }

  unblockBodyScroll(): void {
    document.body.classList.remove('blocked-scroll');
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
    if (this.menuOutsideClickListener) {
      this.menuOutsideClickListener();
    }
  }
}
