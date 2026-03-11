import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { InputOtpModule } from 'primeng/inputotp';
import { filter } from 'rxjs';

import { ILoginResponse, IOtpResponse } from '@chansey/api-interfaces';

import { OtpService } from './otp.service';

import { AuthMessage, AuthMessagesComponent } from '../../../shared/components/auth-messages';
import { AuthPageShellComponent } from '../../../shared/components/auth-page-shell';

@Component({
  selector: 'app-otp',
  standalone: true,
  imports: [
    AuthMessagesComponent,
    AuthPageShellComponent,
    ButtonModule,
    InputOtpModule,
    ReactiveFormsModule,
    RouterLink
  ],
  templateUrl: './otp.component.html'
})
export class OtpComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly otpService = inject(OtpService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly verifyOtpMutation = this.otpService.useVerifyOtpMutation();
  readonly resendOtpMutation = this.otpService.useResendOtpMutation();

  otpForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]]
  });
  messages = signal<AuthMessage[]>([]);
  formSubmitted = signal(false);
  emailCensored: string | null = null;
  email: string | null = null;

  constructor() {
    this.email = sessionStorage.getItem('otpEmail');
    this.emailCensored = this.email ? this.email.replace(/(.{2})(.*)(@.*)/, '$1****$3') : null;

    if (!this.email) {
      this.router.navigate(['/login']);
      return;
    }

    this.otpForm
      .get('code')
      ?.valueChanges.pipe(
        takeUntilDestroyed(this.destroyRef),
        filter((value) => value?.length === 6)
      )
      .subscribe(() => this.onSubmit());
  }

  onSubmit() {
    this.formSubmitted.set(true);
    if (this.otpForm.valid && this.email) {
      const { code } = this.otpForm.getRawValue();

      this.verifyOtpMutation.mutate(
        { otp: code, email: this.email },
        {
          onSuccess: (response: ILoginResponse) => {
            if (response.user) {
              sessionStorage.removeItem('otpEmail');
              this.router.navigate(['/app/dashboard']);
            } else {
              this.messages.set([
                {
                  content: response.message || 'Invalid verification code. Please try again.',
                  severity: 'warn',
                  icon: 'pi-exclamation-circle'
                }
              ]);
            }
          },
          onError: (error) => {
            this.messages.set([
              {
                content: error.message || 'Failed to verify code. Please try again.',
                severity: 'error',
                icon: 'pi-exclamation-circle'
              }
            ]);
          }
        }
      );
    }
  }

  resendOtp() {
    if (!this.email) return;

    this.resendOtpMutation.mutate(
      { email: this.email },
      {
        onSuccess: (response: IOtpResponse) => {
          this.messages.set([
            {
              content: response.message || 'Verification code resent successfully.',
              severity: 'success',
              icon: 'pi-check-circle'
            }
          ]);
        },
        onError: (error) => {
          this.messages.set([
            {
              content: error.message || 'Failed to resend verification code.',
              severity: 'error',
              icon: 'pi-exclamation-circle'
            }
          ]);
        }
      }
    );
  }
}
