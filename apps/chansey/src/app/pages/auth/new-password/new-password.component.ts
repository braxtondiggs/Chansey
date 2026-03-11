import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { PasswordModule } from 'primeng/password';
import { take, timer } from 'rxjs';

import { NewPasswordService } from './new-password.service';

import { AuthMessage, AuthMessagesComponent } from '../../../shared/components/auth-messages';
import { AuthPageShellComponent } from '../../../shared/components/auth-page-shell';
import { PasswordRequirementsComponent } from '../../../shared/components/password-requirements';
import { PasswordMatchValidator, getPasswordError } from '../../../validators/password-match.validator';
import { PasswordStrengthValidator } from '../../../validators/password-strength.validator';
import { AUTH_REDIRECT_DELAY } from '../auth.constants';

@Component({
  selector: 'app-new-password',
  standalone: true,
  imports: [
    AuthMessagesComponent,
    AuthPageShellComponent,
    ButtonModule,
    FloatLabelModule,
    FluidModule,
    PasswordModule,
    PasswordRequirementsComponent,
    ReactiveFormsModule,
    RouterLink
  ],
  templateUrl: './new-password.component.html'
})
export class NewPasswordComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly newPasswordService = inject(NewPasswordService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly newPasswordMutation = this.newPasswordService.useResetPasswordMutation();

  newPasswordForm = this.fb.group(
    {
      password: ['', [Validators.required, PasswordStrengthValidator()]],
      confirmPassword: ['', Validators.required]
    },
    {
      validators: PasswordMatchValidator
    }
  );
  messages = signal<AuthMessage[]>([]);
  formSubmitted = signal(false);
  token: string | null = null;

  constructor() {
    this.route.queryParams.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.token = params['token'];

      if (!this.token) {
        this.messages.set([
          {
            content: 'Invalid or missing reset token. Please try again.',
            severity: 'error',
            icon: 'pi-exclamation-circle'
          }
        ]);
        timer(AUTH_REDIRECT_DELAY)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(() => this.router.navigate(['/login']));
      }
    });
  }

  getPasswordError(controlName: string): string {
    return getPasswordError(this.newPasswordForm, controlName, this.formSubmitted());
  }

  onSubmit() {
    this.formSubmitted.set(true);

    if (this.newPasswordForm.valid && this.token) {
      const { password, confirmPassword } = this.newPasswordForm.getRawValue();

      this.newPasswordMutation.mutate(
        { token: this.token, password, confirm_password: confirmPassword },
        {
          onSuccess: (response) => {
            this.messages.set([
              {
                content: response.message || 'Password successfully reset!',
                severity: 'success',
                icon: 'pi-check-circle'
              }
            ]);
            setTimeout(() => {
              this.router.navigate(['/login']);
            }, AUTH_REDIRECT_DELAY);
          },
          onError: (error) => {
            this.messages.set([
              {
                content: error?.message || 'An error occurred. Please try again later.',
                severity: 'error',
                icon: 'pi-exclamation-circle'
              }
            ]);
          }
        }
      );
    }
  }
}
