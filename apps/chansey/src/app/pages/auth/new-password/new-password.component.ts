import { CommonModule } from '@angular/common';
import { Component, OnInit, signal, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { LazyImageComponent } from '@chansey-web/app/components/lazy-image.component';
import { PasswordStrengthValidator, PasswordMatchValidator, getPasswordError } from '@chansey-web/app/validators';

import { NewPasswordService } from './new-password.service';

@Component({
  selector: 'app-new-password',
  standalone: true,
  imports: [
    CommonModule,
    ButtonModule,
    FloatLabelModule,
    FluidModule,
    InputTextModule,
    LazyImageComponent,
    MessageModule,
    PasswordModule,
    ReactiveFormsModule,
    RouterLink
  ],
  templateUrl: './new-password.component.html'
})
export class NewPasswordComponent implements OnInit {
  private fb = inject(FormBuilder);
  private newPasswordService = inject(NewPasswordService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly newPasswordMutation = this.newPasswordService.useResetPasswordMutation();

  newPasswordForm: FormGroup = this.fb.group(
    {
      password: ['', [Validators.required, PasswordStrengthValidator()]],
      confirmPassword: ['', Validators.required]
    },
    {
      validators: PasswordMatchValidator
    }
  );
  messages = signal<any[]>([]);
  formSubmitted = false;
  token: string | null = null;

  ngOnInit() {
    this.route.queryParams.subscribe((params) => {
      this.token = params['token'];

      if (!this.token) {
        this.messages.set([
          {
            content: 'Invalid or missing reset token. Please try again.',
            severity: 'error',
            icon: 'pi-exclamation-circle'
          }
        ]);
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 3000);
      }
    });
  }

  getPasswordError(controlName: string): string {
    return getPasswordError(this.newPasswordForm, controlName, this.formSubmitted);
  }

  onSubmit() {
    this.formSubmitted = true;

    if (this.newPasswordForm.valid && this.token) {
      const { password, confirmPassword } = this.newPasswordForm.value;

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
            }, 2000);
          },
          onError: (error) => {
            this.messages.set([
              {
                content: error?.message || 'An error occurred. Please try again later.',
                severity: 'error',
                icon: 'pi-exclamation-circle'
              }
            ]);
            console.error('Password reset error:', error);
          }
        }
      );
    }
  }
}
