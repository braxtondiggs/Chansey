import { Component, model, output } from '@angular/core';

import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';

@Component({
  selector: 'app-timeout-warning',
  standalone: true,
  imports: [DialogModule, ButtonModule],
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
          <span class="font-bold">{{ remainingTime() }}</span> seconds.
        </p>
        <p>Do you want to continue your session?</p>
      </div>
      <ng-template #footer>
        <div class="justify-content-end flex gap-2">
          <p-button label="Logout" severity="danger" variant="outlined" (click)="onLogout()"></p-button>
          <p-button label="Continue Session" severity="secondary" (click)="onContinue()"></p-button>
        </div>
      </ng-template>
    </p-dialog>
  `
})
export class TimeoutWarningComponent {
  readonly visible = model(false);
  readonly remainingTime = model(60);

  logout = output<void>();
  continue = output<void>();

  onLogout(): void {
    this.logout.emit();
  }

  onContinue(): void {
    this.continue.emit();
  }
}
