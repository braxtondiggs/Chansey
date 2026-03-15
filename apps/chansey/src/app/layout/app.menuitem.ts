import { AnimationEvent, animate, state, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { DomHandler } from 'primeng/dom';
import { RippleModule } from 'primeng/ripple';
import { TooltipModule } from 'primeng/tooltip';
import { filter } from 'rxjs/operators';

import { MenuItem } from './app.menu';

import { LayoutService } from '../shared/services/layout.service';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: '[chansey-menuitem]',
  imports: [CommonModule, RouterModule, RippleModule, TooltipModule],
  template: `
    <ng-container>
      @if (root && item.visible !== false) {
        <div class="layout-menuitem-root-text">
          {{ item.label }}
        </div>
      }
      @if ((!item.routerLink || item.items) && item.visible !== false) {
        <a
          [attr.href]="item.url"
          (click)="itemClick($event)"
          (mouseenter)="onMouseEnter()"
          [ngClass]="item.class"
          [attr.target]="item.target"
          tabindex="0"
          pRipple
          [pTooltip]="item.label"
          [tooltipDisabled]="isCompactLayout() || !root || active"
        >
          <i [ngClass]="item.icon" class="layout-menuitem-icon"></i>
          <span class="layout-menuitem-text">{{ item.label }}</span>
          @if (item.items) {
            <i class="pi pi-fw pi-angle-down layout-submenu-toggler"></i>
          }
        </a>
      }
      @if (item.routerLink && !item.items && item.visible !== false) {
        <a
          (click)="itemClick($event)"
          (mouseenter)="onMouseEnter()"
          [ngClass]="item.class"
          [routerLink]="item.routerLink"
          routerLinkActive="active-route"
          [routerLinkActiveOptions]="
            item.routerLinkActiveOptions || {
              paths: 'exact',
              queryParams: 'ignored',
              matrixParams: 'ignored',
              fragment: 'ignored'
            }
          "
          [fragment]="item.fragment"
          [queryParamsHandling]="item.queryParamsHandling"
          [preserveFragment]="item.preserveFragment"
          [skipLocationChange]="item.skipLocationChange"
          [replaceUrl]="item.replaceUrl"
          [state]="item.state"
          [queryParams]="item.queryParams"
          [attr.target]="item.target"
          tabindex="0"
          pRipple
          [pTooltip]="item.label"
          [tooltipDisabled]="isCompactLayout() || !root"
        >
          <i [ngClass]="item.icon" class="layout-menuitem-icon"></i>
          <span class="layout-menuitem-text">{{ item.label }}</span>
          @if (item.items) {
            <i class="pi pi-fw pi-angle-down layout-submenu-toggler"></i>
          }
        </a>
      }

      @if (item.items && item.visible !== false) {
        <ul #submenu [@children]="submenuAnimation" (@children.done)="onSubmenuAnimated($event)">
          @for (child of item.items; track child; let i = $index) {
            <li chansey-menuitem [item]="child" [index]="i" [parentKey]="key" [ngClass]="child.badgeClass"></li>
          }
        </ul>
      }
    </ng-container>
  `,
  animations: [
    trigger('children', [
      state(
        'collapsed',
        style({
          height: '0'
        })
      ),
      state(
        'expanded',
        style({
          height: '*'
        })
      ),
      state(
        'hidden',
        style({
          display: 'none'
        })
      ),
      state(
        'visible',
        style({
          display: 'block'
        })
      ),
      transition('collapsed <=> expanded', animate('400ms cubic-bezier(0.86, 0, 0.07, 1)'))
    ])
  ]
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppMenuitem implements OnInit, AfterViewChecked {
  @Input() item!: MenuItem;

  @Input() index!: number;

  @Input() @HostBinding('class.layout-root-menuitem') root!: boolean;

  @Input() parentKey!: string;

  @ViewChild('submenu') submenu!: ElementRef;

  @HostBinding('class.active-menuitem')
  get activeClass() {
    return this.active;
  }

  active = false;

  key = '';

  readonly isCompactLayout = computed(
    () => this.layoutService.isSlim() || this.layoutService.isHorizontal() || this.layoutService.isCompact()
  );

  get submenuAnimation() {
    if (this.layoutService.isDesktop() && this.isCompactLayout()) {
      return this.active ? 'visible' : 'hidden';
    } else return this.root ? 'expanded' : this.active ? 'expanded' : 'collapsed';
  }

  get isDesktop() {
    return this.layoutService.isDesktop();
  }

  get isMobile() {
    return this.layoutService.isMobile();
  }

  readonly layoutService = inject(LayoutService);
  readonly router = inject(Router);

  constructor() {
    this.layoutService.menuSource$.pipe(takeUntilDestroyed()).subscribe((value) => {
      if (value.routeEvent) {
        this.active = value.key === this.key || value.key.startsWith(this.key + '-');
      } else {
        if (value.key !== this.key && !value.key.startsWith(this.key + '-')) {
          this.active = false;
        }
      }
    });

    this.layoutService.resetSource$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.active = false;
    });

    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe(() => {
        if (this.isCompactLayout()) {
          this.active = false;
        } else {
          if (this.item.routerLink) {
            this.updateActiveStateFromRoute();
          }
        }
      });

    effect(() => {
      if (this.layoutService.isOverlay() && this.layoutService.isSidebarActive()) {
        if (this.item.routerLink) {
          this.updateActiveStateFromRoute();
        }
      }
    });
  }

  ngOnInit() {
    this.key = this.parentKey ? this.parentKey + '-' + this.index : String(this.index);

    if (!this.isCompactLayout() && this.item.routerLink) {
      this.updateActiveStateFromRoute();
    }
  }

  ngAfterViewChecked() {
    if (this.root && this.active && this.isDesktop && this.isCompactLayout()) {
      this.calculatePosition(this.submenu?.nativeElement, this.submenu?.nativeElement.parentElement);
    }
  }

  updateActiveStateFromRoute() {
    if (!this.item.routerLink) return;

    const activeRoute = this.router.isActive(this.item.routerLink[0], {
      paths: 'exact',
      queryParams: 'ignored',
      matrixParams: 'ignored',
      fragment: 'ignored'
    });

    if (activeRoute) {
      this.layoutService.onMenuStateChange({
        key: this.key,
        routeEvent: true
      });
    }
  }
  onSubmenuAnimated(event: AnimationEvent) {
    if (event.toState === 'visible' && this.isDesktop && this.isCompactLayout()) {
      const el = <HTMLUListElement>event.element;
      const elParent = <HTMLUListElement>el.parentElement;
      this.calculatePosition(el, elParent);
    }
  }

  calculatePosition(overlay: HTMLElement, target: HTMLElement) {
    if (overlay) {
      const { left, top } = target.getBoundingClientRect();
      const [vWidth, vHeight] = [window.innerWidth, window.innerHeight];
      const [oWidth, oHeight] = [overlay.offsetWidth, overlay.offsetHeight];
      const scrollbarWidth = DomHandler.calculateScrollbarWidth();
      // reset
      overlay.style.top = '';
      overlay.style.left = '';

      if (this.layoutService.isHorizontal()) {
        const width = left + oWidth + scrollbarWidth;
        overlay.style.left = vWidth < width ? `${left - (width - vWidth)}px` : `${left}px`;
      } else if (this.layoutService.isSlim() || this.layoutService.isCompact()) {
        const height = top + oHeight;
        overlay.style.top = vHeight < height ? `${top - (height - vHeight)}px` : `${top}px`;
      }
    }
  }

  itemClick(event: Event) {
    // avoid processing disabled items
    if (this.item.disabled) {
      event.preventDefault();
      return;
    }

    // navigate with hover
    if (
      (this.root && this.layoutService.isSlim()) ||
      this.layoutService.isHorizontal() ||
      this.layoutService.isCompact()
    ) {
      this.layoutService.layoutState.update((val) => ({
        ...val,
        menuHoverActive: !val.menuHoverActive
      }));
    }

    // execute command
    if (this.item.command) {
      this.item.command({ originalEvent: event, item: this.item });
    }

    // toggle active state
    if (this.item.items) {
      this.active = !this.active;

      if (this.root && this.active && this.isCompactLayout()) {
        this.layoutService.onOverlaySubmenuOpen();
      }
    } else {
      if (this.layoutService.isMobile()) {
        this.layoutService.layoutState.update((val) => ({
          ...val,
          staticMenuMobileActive: false
        }));
      }

      if (this.isCompactLayout()) {
        this.layoutService.reset();
        this.layoutService.layoutState.update((val) => ({
          ...val,
          menuHoverActive: false
        }));
      }
    }

    this.layoutService.onMenuStateChange({ key: this.key });
  }

  onMouseEnter() {
    // activate item on hover
    if (this.root && this.isCompactLayout() && this.layoutService.isDesktop()) {
      if (this.layoutService.layoutState().menuHoverActive) {
        this.active = true;
        this.layoutService.onMenuStateChange({ key: this.key });
      }
    }
  }
}
