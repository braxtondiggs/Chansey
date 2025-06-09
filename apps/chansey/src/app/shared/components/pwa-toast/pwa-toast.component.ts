import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, OnDestroy } from '@angular/core';

import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { Subject, takeUntil } from 'rxjs';

import { PwaService } from '@chansey-web/app/shared/services';

@Component({
  selector: 'app-pwa-toast',
  standalone: true,
  imports: [CommonModule, ButtonModule, ToastModule],
  providers: [MessageService],
  template: `
    <p-toast position="top-right" key="pwa-updates">
      <ng-template let-message pTemplate="message">
        <div class="flex w-full flex-col gap-3">
          <div class="flex items-center gap-2">
            <i [class]="message.icon" class="text-xl"></i>
            <span class="text-lg font-bold">{{ message.summary }}</span>
          </div>
          <p class="m-0">{{ message.detail }}</p>
          <div class="flex justify-end gap-2" *ngIf="message.data?.type === 'update'">
            <p-button label="Later" severity="secondary" size="small" (onClick)="dismissUpdate()" />
            <p-button label="Update Now" size="small" (onClick)="applyUpdate()" />
          </div>
        </div>
      </ng-template>
    </p-toast>
  `
})
export class PwaToastComponent implements OnInit, OnDestroy {
  private readonly pwaService = inject(PwaService);
  private readonly messageService = inject(MessageService);
  private readonly destroy$ = new Subject<void>();

  ngOnInit() {
    // Listen for PWA updates
    this.pwaService.updateAvailable$.pipe(takeUntil(this.destroy$)).subscribe((updateAvailable) => {
      if (updateAvailable) this.showUpdateNotification();
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private showUpdateNotification() {
    this.messageService.add({
      key: 'pwa-updates',
      severity: 'info',
      summary: 'Update Available',
      detail: 'A new version of the app is available with improvements and bug fixes.',
      sticky: true,
      closable: false,
      icon: 'pi pi-refresh',
      data: { type: 'update' }
    });
  }

  applyUpdate() {
    this.messageService.clear('pwa-updates');
    this.pwaService.applyUpdate();
  }

  dismissUpdate() {
    this.messageService.clear('pwa-updates');
  }
}
