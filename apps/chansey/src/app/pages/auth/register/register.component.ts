import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { LazyImageComponent } from '@chansey-web/app/components/lazy-image.component';
import { PasswordStrengthValidator, PasswordMatchValidator, getPasswordError } from '@chansey-web/app/validators';

import { RegisterService } from './register.service';

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
    MessageModule,
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
  successMessage = '';
  formSubmitted = false;

  constructor(
    private fb: FormBuilder,
    private registerService: RegisterService
  ) {
    this.registerForm = this.fb.group(
      {
        given_name: ['', Validators.required],
        family_name: ['', Validators.required],
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, PasswordStrengthValidator()]],
        confirmPassword: ['', Validators.required]
      },
      {
        validators: PasswordMatchValidator
      }
    );
  }

  getPasswordError(controlName: string): string {
    return getPasswordError(this.registerForm, controlName, this.formSubmitted);
  }

  onSubmit() {
    this.formSubmitted = true;

    if (this.registerForm.valid) {
      this.isLoading = true;
      this.errorMessage = '';
      this.successMessage = '';

      const { email, password, confirmPassword, given_name, family_name } = this.registerForm.value;

      this.registerService.register(email, password, confirmPassword, given_name, family_name).subscribe({
        next: () => {
          this.isLoading = false;
          this.formSubmitted = false;
          this.successMessage = 'Registration successful! Please check your email for verification.';
          this.registerForm.reset();
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
