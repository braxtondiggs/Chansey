import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputOtpModule } from 'primeng/inputotp';
import { MessageModule } from 'primeng/message';

import { LazyImageComponent } from '@chansey-web/app/components/lazy-image.component';

import { OtpService } from './otp.service';

@Component({
  selector: 'app-otp',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    InputOtpModule,
    LazyImageComponent,
    MessageModule,
    MessageModule,
    ReactiveFormsModule,
    RouterLink
  ],
  providers: [MessageService],
  templateUrl: './otp.component.html'
})
export class OtpComponent implements OnInit {
  otpForm: FormGroup;
  isLoading = false;
  isResending = false;
  messages = signal<any[]>([]);
  formSubmitted = false;
  emailCensored: string | null = null;
  email: string | null = null;

  constructor(
    private fb: FormBuilder,
    private otpService: OtpService,
    private router: Router
  ) {
    this.otpForm = this.fb.group({
      code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]]
    });
  }

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
      this.isLoading = true;
      const { code } = this.otpForm.value;

      this.otpService.verifyOtp(code, this.email).subscribe({
        next: (response) => {
          this.isLoading = false;
          if (response.success) {
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
        error: (error) => {
          this.isLoading = false;
          this.messages.set([
            {
              content: error.error?.message || 'Failed to verify code. Please try again.',
              severity: 'error',
              icon: 'pi-exclamation-circle'
            }
          ]);
          console.error('OTP verification error:', error);
        }
      });
    }
  }

  resendOtp() {
    this.isResending = true;
    this.otpService.resendOtp().subscribe({
      next: (response) => {
        this.isResending = false;
        this.messages.set([
          {
            content: response.message || 'Verification code resent successfully.',
            severity: 'success',
            icon: 'pi-check-circle'
          }
        ]);
      },
      error: (error) => {
        this.isResending = false;
        this.messages.set([
          {
            content: error.error?.message || 'Failed to resend verification code.',
            severity: 'error',
            icon: 'pi-exclamation-circle'
          }
        ]);
        console.error('Resend OTP error:', error);
      }
    });
  }
}
