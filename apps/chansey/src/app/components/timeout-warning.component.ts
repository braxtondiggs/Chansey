import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

@Component({
  selector: 'app-timeout-warning',
  standalone: true,
  imports: [CommonModule, DialogModule, ButtonModule],
  template: `
    <p-dialog
      [(visible)]="visible"
      [modal]="true"
      [closable]="false"
      [draggable]="false"
      [resizable]="false"
      header="Session Timeout Warning"
      [style]="{ width: '450px' }"
    >
      <div class="flex flex-col gap-4">
        <p>
          Your session is about to expire due to inactivity. You will be automatically logged out in
          <span class="font-bold">{{ remainingTime }}</span> seconds.
        </p>
        <p>Do you want to continue your session?</p>
      </div>
      <ng-template pTemplate="footer">
        <div class="justify-content-end flex gap-2">
          <p-button label="Logout" styleClass="p-button-outlined p-button-danger" (click)="onLogout()"></p-button>
          <p-button label="Continue Session" styleClass="p-button-primary" (click)="onContinue()"></p-button>
        </div>
      </ng-template>
    </p-dialog>
  `
})
export class TimeoutWarningComponent {
  @Input() visible = false;
  @Input() remainingTime = 60;

  @Output() logout = new EventEmitter<void>();
  @Output() continue = new EventEmitter<void>();

  onLogout(): void {
    this.logout.emit();
  }

  onContinue(): void {
    this.continue.emit();
  }
}
