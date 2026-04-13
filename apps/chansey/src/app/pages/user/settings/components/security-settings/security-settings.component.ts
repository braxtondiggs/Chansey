import { ChangeDetectionStrategy, Component, effect, inject, signal, viewChild } from '@angular/core';
import { FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';

import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { FloatLabelModule } from 'primeng/floatlabel';
import { PanelModule } from 'primeng/panel';
import { PasswordModule } from 'primeng/password';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

import { ChangePasswordRequest } from '@chansey/api-interfaces';

import { AuthService } from '../../../../../shared/services/auth.service';
import { SettingsService } from '../../settings.service';
import { createSinglePanelState } from '../../utils/panel-state';
import { ChangePasswordComponent } from '../change-password/change-password.component';

@Component({
  selector: 'app-security-settings',
  imports: [
    ButtonModule,
    ChangePasswordComponent,
    DialogModule,
    FloatLabelModule,
    FormsModule,
    PanelModule,
    PasswordModule,
    ReactiveFormsModule,
    ToggleSwitchModule
  ],
  templateUrl: './security-settings.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SecuritySettingsComponent {
  private messageService = inject(MessageService);
  private confirmationService = inject(ConfirmationService);
  private settingsService = inject(SettingsService);
  private authService = inject(AuthService);

  private readonly userQuery = this.authService.useUser();
  readonly enableOtpMutation = this.settingsService.useEnableOtpMutation();
  readonly disableOtpMutation = this.settingsService.useDisableOtpMutation();
  readonly changePasswordMutation = this.settingsService.useChangePasswordMutation();

  readonly changePasswordRef = viewChild.required<ChangePasswordComponent>('changePasswordRef');

  showPasswordDialog = signal(false);
  disablePassword = '';

  private twoFactorPanelState = createSinglePanelState('security.twoFactorAuth');
  get twoFactorPanelCollapsed() {
    return this.twoFactorPanelState.collapsed;
  }
  onTwoFactorPanelToggle = this.twoFactorPanelState.onToggle;

  securityForm = new FormGroup({
    twoFactorAuth: new FormControl({ value: false, disabled: false })
  });

  constructor() {
    effect(() => {
      const userData = this.userQuery.data();
      if (userData) {
        this.securityForm.patchValue({ twoFactorAuth: userData.otpEnabled });
      }
    });
  }

  toggleTwoFactorAuth(event: { checked: boolean }): void {
    const twoFactorControl = this.securityForm.get('twoFactorAuth');

    if (event.checked) {
      this.confirmationService.confirm({
        header: 'Enable Two-Factor Authentication',
        message:
          'This will add an extra layer of security to your account. You will need to verify your identity using an additional method when logging in. Continue?',
        icon: 'pi pi-lock',
        acceptButtonProps: {
          label: 'Enable 2FA',
          severity: 'primary'
        },
        rejectButtonProps: {
          label: 'Cancel',
          severity: 'secondary'
        },
        accept: () => {
          this.enableOtpMutation.mutate(undefined, {
            onSuccess: () => {
              this.securityForm.patchValue({ twoFactorAuth: true });
              this.messageService.add({
                severity: 'success',
                summary: '2FA Enabled',
                detail: 'Two-factor authentication has been enabled'
              });
            },
            onError: (error: Error) => {
              twoFactorControl?.setValue(false, { emitEvent: false });
              this.messageService.add({
                severity: 'error',
                summary: 'Error',
                detail: error?.message || 'Failed to enable 2FA'
              });
            }
          });
        },
        reject: () => {
          twoFactorControl?.setValue(false, { emitEvent: false });
        }
      });
    } else {
      twoFactorControl?.setValue(true, { emitEvent: false });
      this.disablePassword = '';
      this.showPasswordDialog.set(true);
    }
  }

  confirmDisable2FA(): void {
    if (!this.disablePassword) {
      this.messageService.add({
        severity: 'warn',
        summary: 'Password Required',
        detail: 'Please enter your password to disable 2FA'
      });
      return;
    }

    const twoFactorControl = this.securityForm.get('twoFactorAuth');

    this.disableOtpMutation.mutate(
      { password: this.disablePassword },
      {
        onSuccess: () => {
          this.showPasswordDialog.set(false);
          this.disablePassword = '';
          this.securityForm.get('twoFactorAuth')?.setValue(false);
          this.messageService.add({
            severity: 'warn',
            summary: '2FA Disabled',
            detail: 'Two-factor authentication has been disabled'
          });
        },
        onError: (error: Error) => {
          twoFactorControl?.setValue(true, { emitEvent: false });
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'Failed to disable 2FA. Check your password.'
          });
        }
      }
    );
  }

  cancelDisable2FA(): void {
    this.showPasswordDialog.set(false);
    this.disablePassword = '';
  }

  onChangePassword(passwordData: ChangePasswordRequest): void {
    this.changePasswordMutation.mutate(passwordData, {
      onSuccess: () => {
        this.messageService.add({
          severity: 'success',
          summary: 'Password Changed',
          detail: 'Your password has been updated successfully'
        });
        this.changePasswordRef()?.resetForm();
      },
      onError: (error: Error & { status?: number }) => {
        const errorMessage =
          error.status === 400
            ? 'Invalid password. Please check your inputs and try again.'
            : 'Failed to update password. Please try again.';
        this.messageService.add({ severity: 'error', summary: 'Password Change Failed', detail: errorMessage });
      }
    });
  }
}
