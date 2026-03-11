import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FluidModule } from 'primeng/fluid';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';

import { IRegister } from '@chansey/api-interfaces';

import { RegisterService } from './register.service';

import { AuthMessage, AuthMessagesComponent } from '../../../shared/components/auth-messages';
import { AuthPageShellComponent } from '../../../shared/components/auth-page-shell';
import { PasswordRequirementsComponent } from '../../../shared/components/password-requirements';
import { PasswordMatchValidator, getPasswordError } from '../../../validators/password-match.validator';
import { PasswordStrengthValidator } from '../../../validators/password-strength.validator';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [
    AuthMessagesComponent,
    AuthPageShellComponent,
    ButtonModule,
    FloatLabelModule,
    FluidModule,
    InputTextModule,
    PasswordModule,
    PasswordRequirementsComponent,
    ReactiveFormsModule,
    RouterLink
  ],
  templateUrl: './register.component.html'
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly registerService = inject(RegisterService);
  readonly registerMutation = this.registerService.useRegisterMutation();

  registerForm = this.fb.group(
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

  messages = signal<AuthMessage[]>([]);
  formSubmitted = signal(false);

  getPasswordError(controlName: string): string {
    return getPasswordError(this.registerForm, controlName, this.formSubmitted());
  }

  onSubmit() {
    this.formSubmitted.set(true);

    if (this.registerForm.valid) {
      const {
        email,
        password,
        given_name,
        family_name,
        confirmPassword: confirm_password
      } = this.registerForm.getRawValue();
      const registerData: IRegister = {
        email,
        password,
        confirm_password,
        given_name,
        family_name
      };

      this.registerMutation.mutate(registerData, {
        onSuccess: () => {
          this.formSubmitted.set(false);
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
        }
      });
    }
  }
}
