import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
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
  newPasswordForm: FormGroup;
  isLoading = false;
  messages = signal<any[]>([]);
  formSubmitted = false;
  token: string | null = null;

  constructor(
    private fb: FormBuilder,
    private newPasswordService: NewPasswordService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.newPasswordForm = this.fb.group(
      {
        password: ['', [Validators.required, PasswordStrengthValidator()]],
        confirmPassword: ['', Validators.required]
      },
      {
        validators: PasswordMatchValidator
      }
    );
  }

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
      this.isLoading = true;

      const { password, confirmPassword } = this.newPasswordForm.value;

      this.newPasswordService.submit(this.token, password, confirmPassword).subscribe({
        next: (response) => {
          this.isLoading = false;
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
        error: (error) => {
          this.isLoading = false;
          this.messages.set([
            {
              content: error.error?.message || 'An error occurred. Please try again later.',
              severity: 'error',
              icon: 'pi-exclamation-circle'
            }
          ]);
          console.error('Password reset error:', error);
        }
      });
    }
  }
}
