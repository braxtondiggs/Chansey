import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { LazyImageComponent } from '@chansey-web/app/shared/components/lazy-image/lazy-image.component';

import { LoginService } from './login.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CheckboxModule,
    CommonModule,
    ButtonModule,
    FloatLabelModule,
    InputTextModule,
    LazyImageComponent,
    MessageModule,
    PasswordModule,
    ReactiveFormsModule,
    RouterLink,
    FluidModule
  ],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly loginService = inject(LoginService);
  private readonly router = inject(Router);
  readonly loginMutation = this.loginService.useLogin();

  messages = signal<any[]>([]);
  formSubmitted = false;
  loginForm = this.fb.group({
    email: ['', Validators.compose([Validators.required, Validators.email])],
    password: ['', Validators.required],
    remember: [false]
  });

  onSubmit() {
    this.formSubmitted = true;
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
            } else if (response.user) {
              this.router.navigate(['/app/dashboard']);
            } else {
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
            this.messages.set([
              {
                content: error?.message || 'Login failed. Please check your credentials.',
                severity: 'error',
                icon: 'pi-exclamation-circle'
              }
            ]);
            console.error('Login error:', error);
          }
        }
      );
    }
  }
}
