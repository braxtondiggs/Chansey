import { CommonModule } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputOtpModule } from 'primeng/inputotp';
import { MessageModule } from 'primeng/message';

import { ILoginResponse, IOtpResponse } from '@chansey/api-interfaces';

import { LazyImageComponent } from '@chansey-web/app/shared/components/lazy-image/lazy-image.component';

import { OtpService } from './otp.service';

interface Message {
  content: string;
  severity: 'success' | 'info' | 'warn' | 'error';
  icon: string;
}

@Component({
  selector: 'app-otp',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    InputOtpModule,
    LazyImageComponent,
    MessageModule,
    ReactiveFormsModule,
    RouterLink
  ],
  providers: [MessageService],
  templateUrl: './otp.component.html'
})
export class OtpComponent implements OnInit {
  // Use inject instead of constructor
  private fb = inject(FormBuilder);
  private otpService = inject(OtpService);
  private router = inject(Router);

  // TanStack Query mutations
  readonly verifyOtpMutation = this.otpService.useVerifyOtpMutation();
  readonly resendOtpMutation = this.otpService.useResendOtpMutation();

  otpForm: FormGroup = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]]
  });
  messages = signal<Message[]>([]);
  formSubmitted = false;
  emailCensored: string | null = null;
  email: string | null = null;

  ngOnInit(): void {
    this.email = sessionStorage.getItem('otpEmail');
    this.emailCensored = this.email ? this.email.replace(/(.{2})(.*)(@.*)/, '$1****$3') : null;

    if (!this.email) {
      this.router.navigate(['/login']);
    }
  }

  onSubmit() {
    this.formSubmitted = true;
    if (this.otpForm.valid && this.email) {
      const { code } = this.otpForm.value;

      this.verifyOtpMutation.mutate(
        { otp: code, email: this.email },
        {
          onSuccess: (response: ILoginResponse) => {
            if (response.access_token) {
              // Clear the OTP email from session storage
              sessionStorage.removeItem('otpEmail');

              // Navigate to dashboard
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
            console.error('OTP verification error:', error);
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
          console.error('Resend OTP error:', error);
        }
      }
    );
  }
}
