import { AnimationEvent, animate, state, style, transition, trigger } from '@angular/animations';
import { CommonModule } from '@angular/common';
import {
  AfterViewChecked,
  Component,
  ElementRef,
  HostBinding,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect
} from '@angular/core';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { DomHandler } from 'primeng/dom';
import { RippleModule } from 'primeng/ripple';
import { TooltipModule } from 'primeng/tooltip';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

import { LayoutService } from '@chansey-web/app/shared/services/layout.service';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: '[chansey-menuitem]',
  imports: [CommonModule, RouterModule, RippleModule, TooltipModule],
  template: `
    <ng-container>
      <div *ngIf="root && item.visible !== false" class="layout-menuitem-root-text">
        {{ item.label }}
      </div>
      <a
        *ngIf="(!item.routerLink || item.items) && item.visible !== false"
        [attr.href]="item.url"
        (click)="itemClick($event)"
        (mouseenter)="onMouseEnter()"
        [ngClass]="item.class"
        [attr.target]="item.target"
        tabindex="0"
        pRipple
        [pTooltip]="item.label"
        [tooltipDisabled]="!(!isSlim() && !isHorizontal() && root && !active)"
      >
        <i [ngClass]="item.icon" class="layout-menuitem-icon"></i>
        <span class="layout-menuitem-text">{{ item.label }}</span>
        <i class="pi pi-fw pi-angle-down layout-submenu-toggler" *ngIf="item.items"></i>
      </a>
      <a
        *ngIf="item.routerLink && !item.items && item.visible !== false"
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
        [tooltipDisabled]="!(!isSlim() && !isHorizontal() && root)"
      >
        <i [ngClass]="item.icon" class="layout-menuitem-icon"></i>
        <span class="layout-menuitem-text">{{ item.label }}</span>
        <i class="pi pi-fw pi-angle-down layout-submenu-toggler" *ngIf="item.items"></i>
      </a>

      <ul
        #submenu
        *ngIf="item.items && item.visible !== false"
        [@children]="submenuAnimation"
        (@children.done)="onSubmenuAnimated($event)"
      >
        <ng-template ngFor let-child let-i="index" [ngForOf]="item.items">
          <li chansey-menuitem [item]="child" [index]="i" [parentKey]="key" [class]="child['badgeClass']"></li>
        </ng-template>
      </ul>
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
export class AppMenuitem implements OnInit, OnDestroy, AfterViewChecked {
  @Input() item: any;

  @Input() index!: number;

  @Input() @HostBinding('class.layout-root-menuitem') root!: boolean;

  @Input() parentKey!: string;

  @ViewChild('submenu') submenu!: ElementRef;

  @HostBinding('class.active-menuitem')
  get activeClass() {
    return this.active;
  }

  active = false;

  menuSourceSubscription: Subscription;

  menuResetSubscription: Subscription;

  key = '';

  get submenuAnimation() {
    if (
      this.layoutService.isDesktop() &&
      (this.layoutService.isHorizontal() || this.layoutService.isSlim() || this.layoutService.isCompact())
    ) {
      return this.active ? 'visible' : 'hidden';
    } else return this.root ? 'expanded' : this.active ? 'expanded' : 'collapsed';
  }

  isSlim = computed(() => this.layoutService.isSlim());

  isCompact = computed(() => this.layoutService.isCompact());

  isHorizontal = computed(() => this.layoutService.isHorizontal());

  get isDesktop() {
    return this.layoutService.isDesktop();
  }

  get isMobile() {
    return this.layoutService.isMobile();
  }

  constructor(
    public layoutService: LayoutService,
    public router: Router
  ) {
    this.menuSourceSubscription = this.layoutService.menuSource$.subscribe((value) => {
      Promise.resolve(null).then(() => {
        if (value.routeEvent) {
          this.active = value.key === this.key || value.key.startsWith(this.key + '-') ? true : false;
        } else {
          if (value.key !== this.key && !value.key.startsWith(this.key + '-')) {
            this.active = false;
          }
        }
      });
    });

    this.menuResetSubscription = this.layoutService.resetSource$.subscribe(() => {
      this.active = false;
    });

    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((params) => {
      if (this.isCompact() || this.isSlim() || this.isHorizontal()) {
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

    if (!(this.isCompact() || this.isSlim() || this.isHorizontal()) && this.item.routerLink) {
      this.updateActiveStateFromRoute();
    }
  }

  ngAfterViewChecked() {
    if (this.root && this.active && this.isDesktop && (this.isHorizontal() || this.isSlim() || this.isCompact())) {
      this.calculatePosition(this.submenu?.nativeElement, this.submenu?.nativeElement.parentElement);
    }
  }

  updateActiveStateFromRoute() {
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
    if (event.toState === 'visible' && this.isDesktop && (this.isHorizontal() || this.isSlim() || this.isCompact())) {
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
    if ((this.root && this.isSlim()) || this.isHorizontal() || this.isCompact()) {
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

      if (this.root && this.active && (this.isSlim() || this.isHorizontal() || this.isCompact())) {
        this.layoutService.onOverlaySubmenuOpen();
      }
    } else {
      if (this.layoutService.isMobile()) {
        this.layoutService.layoutState.update((val) => ({
          ...val,
          staticMenuMobileActive: false
        }));
      }

      if (this.isSlim() || this.isHorizontal() || this.isCompact()) {
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
    if (this.root && (this.isSlim() || this.isHorizontal() || this.isCompact()) && this.layoutService.isDesktop()) {
      if (this.layoutService.layoutState().menuHoverActive) {
        this.active = true;
        this.layoutService.onMenuStateChange({ key: this.key });
      }
    }
  }

  ngOnDestroy() {
    if (this.menuSourceSubscription) {
      this.menuSourceSubscription.unsubscribe();
    }

    if (this.menuResetSubscription) {
      this.menuResetSubscription.unsubscribe();
    }
  }
}
