import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
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
  errorMessage = '';
  successMessage = '';
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
        this.errorMessage = 'Invalid or missing reset token. Please try again.';
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
      this.errorMessage = '';
      this.successMessage = '';

      const { password, confirmPassword } = this.newPasswordForm.value;

      this.newPasswordService.submit(this.token, password, confirmPassword).subscribe({
        next: (response) => {
          this.isLoading = false;
          this.successMessage = response.message || 'Password successfully reset!';
          // Redirect to login after successful password reset
          setTimeout(() => {
            this.router.navigate(['/login']);
          }, 2000);
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error.error?.message || 'An error occurred. Please try again later.';
          console.error('Password reset error:', error);
        }
      });
    }
  }
}
