import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { LazyImageComponent } from '@chansey-web/app/components/lazy-image.component';

import { RegisterService } from './register.service';

// Custom validator to check if the passwords match
function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');

  if (password && confirmPassword && password.value !== confirmPassword.value) {
    return { passwordMismatch: true };
  }

  return null;
}

// Custom password validators
function createPasswordStrengthValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;

    if (!value) {
      return null;
    }

    const hasUpperCase = /[A-Z]/.test(value);
    const hasLowerCase = /[a-z]/.test(value);
    const hasNumeric = /[0-9]/.test(value);
    const hasSpecialChar = /[!@#$%^&*()_+\-=[]{};':"\\|,.<>\/?]/.test(value);
    const hasMinLength = value.length >= 8;

    const passwordValid = hasUpperCase && hasLowerCase && hasNumeric && hasSpecialChar && hasMinLength;

    return !passwordValid
      ? {
          passwordStrength: {
            hasUpperCase,
            hasLowerCase,
            hasNumeric,
            hasSpecialChar,
            hasMinLength
          }
        }
      : null;
  };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CheckboxModule,
    CommonModule,
    ButtonModule,
    FloatLabelModule,
    InputTextModule,
    LazyImageComponent,
    PasswordModule,
    ReactiveFormsModule,
    RouterLink
  ],
  templateUrl: './register.component.html'
})
export class RegisterComponent {
  registerForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  formSubmitted = false;

  constructor(
    private fb: FormBuilder,
    private registerService: RegisterService,
    private router: Router
  ) {
    this.registerForm = this.fb.group(
      {
        given_name: ['', Validators.required],
        family_name: ['', Validators.required],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, createPasswordStrengthValidator()]],
        confirmPassword: ['', Validators.required]
      },
      {
        validators: passwordMatchValidator
      }
    );
  }

  getPasswordError(controlName: string): string {
    const control = this.registerForm.get(controlName);
    if (!control || !control.errors) return '';

    if (control.errors['required']) {
      return 'Password is required';
    }

    if (control.errors['passwordStrength']) {
      const errors = control.errors['passwordStrength'];
      if (!errors.hasMinLength) return 'Password must be at least 8 characters';
      if (!errors.hasLowerCase) return 'Password must contain at least one lowercase letter';
      if (!errors.hasUpperCase) return 'Password must contain at least one uppercase letter';
      if (!errors.hasNumeric) return 'Password must contain at least one number';
      if (!errors.hasSpecialChar) return 'Password must contain at least one special character';
    }

    return 'Invalid password';
  }

  onSubmit() {
    this.formSubmitted = true;

    if (this.registerForm.valid) {
      this.isLoading = true;
      this.errorMessage = '';

      const { email, password, confirmPassword, given_name, family_name } = this.registerForm.value;

      this.registerService.register(email, password, confirmPassword, given_name, family_name).subscribe({
        next: (response) => {
          this.isLoading = false;

          this.router.navigate(['/dashboard']);
        },
        error: (error) => {
          this.isLoading = false;
          this.errorMessage = error.error?.message || 'Registration failed. Please check your credentials.';
          console.error('Register error:', error);
        }
      });
    }
  }
}
