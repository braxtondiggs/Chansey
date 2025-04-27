import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { LazyImageComponent } from '@chansey-web/app/components/lazy-image.component';

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
  loginForm: FormGroup;
  isLoading = false;
  messages = signal<any[]>([]);
  formSubmitted = false;

  constructor(
    private fb: FormBuilder,
    private loginService: LoginService,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required],
      remember: [false]
    });
  }

  onSubmit() {
    this.formSubmitted = true;
    if (this.loginForm.valid) {
      this.isLoading = true;

      const { email, password, remember } = this.loginForm.value;

      this.loginService.login(email, password, remember).subscribe({
        next: (response) => {
          this.isLoading = false;
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
        error: (error) => {
          this.isLoading = false;
          this.messages.set([
            {
              content: error.error?.message || 'Login failed. Please check your credentials.',
              severity: 'error',
              icon: 'pi-exclamation-circle'
            }
          ]);
          console.error('Login error:', error);
        }
      });
    }
  }
}
