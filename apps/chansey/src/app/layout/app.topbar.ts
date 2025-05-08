import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, computed, inject, model, signal } from '@angular/core';
import { RouterModule } from '@angular/router';

import { funEmoji } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';
import { AvatarModule } from 'primeng/avatar';
import { StyleClassModule } from 'primeng/styleclass';

import { AppBreadcrumb } from './app.breadcrumb';

import { AuthService, LayoutService } from '../services';

interface NotificationsBars {
  id: string;
  label: string;
  badge?: string | any;
}

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [AvatarModule, AppBreadcrumb, RouterModule, StyleClassModule, CommonModule],
  template: `<div class="layout-topbar">
    <div class="topbar-left">
      <a tabindex="0" #menubutton type="button" class="menu-button" (click)="onMenuButtonClick()">
        <i class="pi pi-chevron-left"></i>
      </a>
      <img class="horizontal-logo" src="/layout/images/logo-white.svg" alt="diamond-layout" />
      <span class="topbar-separator"></span>
      <app-breadcrumb></app-breadcrumb>
      <img class="mobile-logo" src="/public/icons/icon-72x72.png" alt="cymbit trading icon" />
    </div>

    <div class="topbar-right">
      <ul class="topbar-menu">
        <li class="right-sidebar-item">
          <a class="right-sidebar-button" (click)="toggleSearchBar()">
            <i class="pi pi-search"></i>
          </a>
        </li>
        <li class="right-sidebar-item static sm:relative">
          <a
            class="right-sidebar-button relative z-50"
            pStyleClass="@next"
            enterFromClass="hidden"
            enterActiveClass="animate-scalein"
            leaveActiveClass="animate-fadeout"
            leaveToClass="hidden"
            [hideOnOutsideClick]="true"
          >
            <!--<span class="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-red-500"></span>-->
            <i class="pi pi-bell"></i>
          </a>
          <div
            class="border-surface bg-surface-0 dark:bg-surface-900 absolute top-auto z-50 m-0 mt-2 hidden min-w-72 origin-top list-none overflow-hidden rounded-2xl border shadow-[0px_56px_16px_0px_rgba(0,0,0,0.00),0px_36px_14px_0px_rgba(0,0,0,0.01),0px_20px_12px_0px_rgba(0,0,0,0.02),0px_9px_9px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.04)] sm:w-[22rem]"
            style="right: -100px"
          >
            <div class="border-surface flex items-center justify-between border-b p-4">
              <span class="label-small text-surface-950 dark:text-surface-0">Notifications</span>
              <!--<button
                pRipple
                class="text-surface-950 dark:text-surface-0 label-x-small hover:bg-emphasis border-surface rounded-lg border px-2 py-1 shadow-[0px_1px_2px_0px_rgba(18,18,23,0.05)] transition-all"
              >
                Mark all as read
              </button>-->
            </div>
            <!-- Empty state for notifications -->
            <div class="flex flex-col items-center justify-center p-8 text-center">
              <i class="pi pi-bell-slash text-surface-400 mb-3 text-4xl"></i>
              <span class="label-medium text-surface-700 dark:text-surface-300">No notifications yet</span>
              <span class="label-small text-surface-500 dark:text-surface-400 mt-1"
                >We'll notify you when something important happens</span
              >
            </div>
            <!-- Hiding the navigation tabs and notification list since they're not needed for empty state -->
            <!--
            <div class="border-surface flex items-center border-b">
              @for (item of notificationsBars(); track item.id; let i = $index) {
                <button
                  [ngClass]="{
                    'border-surface-950 dark:border-surface-0': selectedNotificationBar() === item.id,
                    'border-transparent': selectedNotificationBar() !== item.id
                  }"
                  class="inline-flex items-center gap-2 border-b px-3.5 py-2"
                  (click)="selectedNotificationBar.set(item.id)"
                >
                  <span
                    [ngClass]="{
                      'text-surface-950 dark:text-surface-0': selectedNotificationBar() === item.id
                    }"
                    class="label-small"
                    >{{ item.label }}</span
                  >
                  <p-badge
                    *ngIf="item?.badge"
                    [value]="item.badge"
                    severity="success"
                    size="small"
                    class="!rounded-md"
                  />
                </button>
              }
            </div>
            <ul class="flex max-h-80 flex-col divide-y divide-[var(--surface-border)] overflow-auto">
              @for (item of selectedNotificationsBarData(); track item.name; let i = $index) {
                <li>
                  <div class="hover:bg-emphasis flex cursor-pointer items-center gap-3 px-6 py-3.5 transition-all">
                    <p-overlay-badge value="" severity="danger" class="inline-flex">
                      <p-avatar size="large">
                        <img [src]="item.image" class="rounded-lg" />
                      </p-avatar>
                    </p-overlay-badge>
                    <div class="flex items-center gap-3">
                      <div class="flex flex-col">
                        <span class="label-small text-surface-950 dark:text-surface-0 text-left">{{ item.name }}</span>
                        <span class="label-xsmall line-clamp-1 text-left">{{ item.description }}</span>
                        <span class="label-xsmall text-left">{{ item.time }}</span>
                      </div>
                      <p-badge *ngIf="item.new" value="" severity="success" />
                    </div>
                  </div>
                  <span *ngIf="i !== notifications().length - 1"></span>
                </li>
              }
            </ul>
            -->
          </div>
        </li>
        <li class="profile-item static sm:relative">
          <a
            class="right-sidebar-button relative z-50"
            pStyleClass="@next"
            enterFromClass="hidden"
            enterActiveClass="animate-scalein"
            leaveActiveClass="animate-fadeout"
            leaveToClass="hidden"
            [hideOnOutsideClick]="true"
          >
            <p-avatar styleClass="!w-10 !h-10" *ngIf="!userLoading()">
              <img [src]="userProfileImage()" />
            </p-avatar>
          </a>
          <div
            class="border-surface bg-surface-0 dark:bg-surface-900 absolute right-0 top-auto z-[999] m-0 mt-2 hidden w-52 origin-top list-none overflow-hidden rounded-2xl border p-2 shadow-[0px_56px_16px_0px_rgba(0,0,0,0.00),0px_36px_14px_0px_rgba(0,0,0,0.01),0px_20px_12px_0px_rgba(0,0,0,0.02),0px_9px_9px_0px_rgba(0,0,0,0.03),0px_2px_5px_0px_rgba(0,0,0,0.04)]"
          >
            <ul class="flex flex-col gap-1">
              <li>
                <a
                  class="label-small dark:text-surface-400 hover:bg-emphasis flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150"
                  routerLink="/app/profile"
                  (click)="closeProfileMenu()"
                >
                  <i class="pi pi-user"></i>
                  <span>Profile</span>
                </a>
              </li>
              <li>
                <a
                  class="label-small dark:text-surface-400 hover:bg-emphasis flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150"
                  routerLink="/app/settings"
                  (click)="closeProfileMenu()"
                >
                  <i class="pi pi-cog"></i>
                  <span>Settings</span>
                </a>
              </li>
              <li>
                <a
                  class="label-small dark:text-surface-400 hover:bg-emphasis flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition-colors duration-150"
                  (click)="logout()"
                >
                  <i class="pi pi-power-off"></i>
                  <span>Log out</span>
                </a>
              </li>
            </ul>
          </div>
        </li>
        <li class="right-sidebar-item">
          <a tabindex="0" class="right-sidebar-button" (click)="showRightMenu()">
            <i class="pi pi-align-right"></i>
          </a>
        </li>
      </ul>
    </div>
  </div>`
})

// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AppTopBar {
  layoutService = inject(LayoutService);
  authService = inject(AuthService);

  user = this.authService.useUser();
  logoutMutation = this.authService.useLogoutMutation();
  userLoading = computed(() => this.user.isPending() || this.user.isFetching());
  userProfileImage = computed(() => {
    const user = this.user.data();
    const avatar = createAvatar(funEmoji, {
      seed: user?.['id']
    });
    return user?.['picture'] || avatar.toDataUri();
  });

  @ViewChild('menubutton') menuButton!: ElementRef;
  //@ViewChild('profileMenu') profileMenu: ElementRef;
  // @ViewChild('profileButton') profileButton: ElementRef;

  logout() {
    this.logoutMutation.mutate(undefined, {
      onSuccess: () => {
        this.closeProfileMenu();
      }
    });
  }

  notificationsBars = signal<NotificationsBars[]>([
    /*{
      id: 'inbox',
      label: 'Inbox',
      badge: '2'
    },
    {
      id: 'general',
      label: 'General'
    },
    {
      id: 'archived',
      label: 'Archived'
    }*/
  ]);

  notifications = signal<any[]>([
    /*{
      id: 'inbox',
      data: [
        {
          image: '/demo/images/avatar/avatar-square-m-2.jpg',
          name: 'Michael Lee',
          description: 'You have a new message from the support team regarding your recent inquiry.',
          time: '1 hour ago',
          new: true
        },
        {
          image: '/demo/images/avatar/avatar-square-f-1.jpg',
          name: 'Alice Johnson',
          description: 'Your report has been successfully submitted and is under review.',
          time: '10 minutes ago',
          new: true
        },
        {
          image: '/demo/images/avatar/avatar-square-f-2.jpg',
          name: 'Emily Davis',
          description: 'The project deadline has been updated to September 30th. Please check the details.',
          time: 'Yesterday at 4:35 PM',
          new: false
        }
      ]
    },
    {
      id: 'general',
      data: [
        {
          image: '/demo/images/avatar/avatar-square-f-1.jpg',
          name: 'Alice Johnson',
          description: 'Reminder: Your subscription is about to expire in 3 days. Renew now to avoid interruption.',
          time: '30 minutes ago',
          new: true
        },
        {
          image: '/demo/images/avatar/avatar-square-m-2.jpg',
          name: 'Michael Lee',
          description: 'The server maintenance has been completed successfully. No further downtime is expected.',
          time: 'Yesterday at 2:15 PM',
          new: false
        }
      ]
    },
    {
      id: 'archived',
      data: [
        {
          image: '/demo/images/avatar/avatar-square-m-1.jpg',
          name: 'Lucas Brown',
          description: 'Your appointment with Dr. Anderson has been confirmed for October 12th at 10:00 AM.',
          time: '1 week ago',
          new: true
        },
        {
          image: '/demo/images/avatar/avatar-square-f-2.jpg',
          name: 'Emily Davis',
          description: 'The document you uploaded has been successfully archived for future reference.',
          time: '2 weeks ago',
          new: false
        }
      ]
    }*/
  ]);

  selectedNotificationBar = model(this.notificationsBars()[0]?.id ?? 'inbox');

  selectedNotificationsBarData = computed(
    () => this.notifications().find((f) => f.id === this.selectedNotificationBar()).data
  );

  onMenuButtonClick() {
    this.layoutService.onMenuToggle();
  }

  showRightMenu() {
    this.layoutService.toggleRightMenu();
  }

  toggleSearchBar() {
    this.layoutService.layoutState.update((value) => ({
      ...value,
      searchBarActive: !value.searchBarActive
    }));
  }

  /**
   * Closes the profile dropdown menu
   */
  closeProfileMenu() {
    // Find and remove the active class from the profile menu
    const profileMenuElement = document.querySelector('.profile-item div:not(.hidden)');
    if (profileMenuElement) {
      profileMenuElement.classList.add('hidden');
    }
  }
}
