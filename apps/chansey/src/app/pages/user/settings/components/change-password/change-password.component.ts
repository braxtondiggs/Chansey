import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { FloatLabel } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { PanelModule } from 'primeng/panel';
import { PasswordModule } from 'primeng/password';

import { ChangePasswordRequest } from '@chansey/api-interfaces';

import { getPasswordError, PasswordMatchValidator } from '../../../../../validators/password-match.validator';
import { PasswordStrengthValidator } from '../../../../../validators/password-strength.validator';
import { createSinglePanelState } from '../../utils/panel-state';

@Component({
  selector: 'app-change-password',
  imports: [ReactiveFormsModule, ButtonModule, FloatLabel, FluidModule, PanelModule, PasswordModule],
  templateUrl: './change-password.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChangePasswordComponent {
  private fb = inject(FormBuilder);

  isPending = input(false);

  changePassword = output<ChangePasswordRequest>();

  passwordFormSubmitted = signal(false);

  private panelState = createSinglePanelState('security.changePassword');
  get panelCollapsed() {
    return this.panelState.collapsed;
  }
  onPanelToggle = this.panelState.onToggle;

  passwordForm: FormGroup = this.fb.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', Validators.compose([Validators.required, PasswordStrengthValidator()])],
      confirmPassword: ['', [Validators.required]]
    },
    { validators: PasswordMatchValidator }
  );

  getPasswordError(controlName: string): string {
    return getPasswordError(this.passwordForm, controlName, this.passwordFormSubmitted());
  }

  onChangePassword(): void {
    this.passwordFormSubmitted.set(true);
    if (this.passwordForm.valid) {
      this.changePassword.emit({
        old_password: this.passwordForm.get('currentPassword')?.value,
        new_password: this.passwordForm.get('newPassword')?.value,
        confirm_new_password: this.passwordForm.get('confirmPassword')?.value
      });
    }
  }

  resetForm(): void {
    this.passwordForm.reset();
    this.passwordFormSubmitted.set(false);
  }
}
