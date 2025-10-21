
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { PasswordModule } from 'primeng/password';

import { IRegister } from '@chansey/api-interfaces';

import { LazyImageComponent } from '@chansey-web/app/shared/components/lazy-image/lazy-image.component';
import { PasswordStrengthValidator, PasswordMatchValidator, getPasswordError } from '@chansey-web/app/validators';

import { RegisterService } from './register.service';

interface Message {
  content: string;
  severity: 'success' | 'error' | 'info' | 'warn';
  icon: string;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    CheckboxModule,
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
  private fb = inject(FormBuilder);
  private registerService = inject(RegisterService);
  readonly registerMutation = this.registerService.useRegisterMutation();

  registerForm: FormGroup = this.fb.group(
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

  messages = signal<Message[]>([]);
  formSubmitted = false;

  getPasswordError(controlName: string): string {
    return getPasswordError(this.registerForm, controlName, this.formSubmitted);
  }

  onSubmit() {
    this.formSubmitted = true;

    if (this.registerForm.valid) {
      const { email, password, given_name, family_name, confirmPassword: confirm_password } = this.registerForm.value;
      const registerData: IRegister = {
        email,
        password,
        confirm_password,
        given_name,
        family_name
      };

      this.registerMutation.mutate(registerData, {
        onSuccess: () => {
          this.formSubmitted = false;
          this.messages.set([
            {
              content: 'Registration successful! Please check your email for verification.',
              severity: 'success',
              icon: 'pi-check-circle'
            }
          ]);
          this.registerForm.reset();
        },
        onError: (error) => {
          this.messages.set([
            {
              content: error.message || 'Registration failed. Please check your credentials.',
              severity: 'error',
              icon: 'pi-exclamation-circle'
            }
          ]);
          console.error('Register error:', error);
        }
      });
    }
  }
}
