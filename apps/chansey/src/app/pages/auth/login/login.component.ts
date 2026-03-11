import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { ErrorCodes, isApiError } from '@chansey/shared';

import { LoginService } from './login.service';

import { AuthMessage, AuthMessagesComponent } from '../../../shared/components/auth-messages';
import { AuthPageShellComponent } from '../../../shared/components/auth-page-shell';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    AuthMessagesComponent,
    AuthPageShellComponent,
    CheckboxModule,
    ButtonModule,
    FloatLabelModule,
    FluidModule,
    InputTextModule,
    PasswordModule,
    ReactiveFormsModule,
    RouterLink
  ],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly loginService = inject(LoginService);
  readonly loginMutation = this.loginService.useLogin();
  readonly resendVerificationMutation = this.loginService.useResendVerificationEmail();

  messages = signal<AuthMessage[]>([]);
  showResendVerification = signal(false);
  formSubmitted = signal(false);
  loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    remember: [false]
  });

  onSubmit() {
    this.formSubmitted.set(true);
    this.showResendVerification.set(false);

    if (this.loginForm.valid) {
      const { email, password, remember } = this.loginForm.value;
      if (!email || !password) return;

      this.loginMutation.mutate(
        {
          email,
          password,
          remember
        },
        {
          onSuccess: (response) => {
            if (response.should_show_email_otp_screen) {
              this.messages.set([
                {
                  content: 'Two-factor authentication is required. Please enter your verification code.',
                  severity: 'info',
                  icon: 'pi-info-circle'
                }
              ]);
            } else if (!response.user) {
              this.messages.set([
                {
                  content: response.message || 'Login failed. Please check your credentials.',
                  severity: 'warn',
                  icon: 'pi-exclamation-circle'
                }
              ]);
            }
          },
          onError: (error) => {
            const errorMessage = error?.message || 'Login failed. Please check your credentials.';

            // Check for email verification required using error code (preferred) or fallback to string matching
            const isEmailVerificationRequired = isApiError(error)
              ? error.hasCode(ErrorCodes.AUTH_EMAIL_NOT_VERIFIED)
              : errorMessage.toLowerCase().includes('verify your email');

            this.showResendVerification.set(isEmailVerificationRequired);
            this.messages.set([
              {
                content: errorMessage,
                severity: 'error',
                icon: 'pi-exclamation-circle'
              }
            ]);
          }
        }
      );
    }
  }

  resendVerificationEmail() {
    const email = this.loginForm.value.email;
    if (!email) return;

    this.resendVerificationMutation.mutate(
      { email },
      {
        onSuccess: () => {
          this.showResendVerification.set(false);
          this.messages.set([
            {
              content: 'Verification email sent! Please check your inbox and verify your email before logging in.',
              severity: 'success',
              icon: 'pi-check-circle'
            }
          ]);
        },
        onError: (error) => {
          this.messages.set([
            {
              content: error?.message || 'Failed to send verification email. Please try again.',
              severity: 'error',
              icon: 'pi-exclamation-circle'
            }
          ]);
        }
      }
    );
  }
}
