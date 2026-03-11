import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';

import { ForgotService } from './forgot.service';

import { AuthMessage, AuthMessagesComponent } from '../../../shared/components/auth-messages';
import { AuthPageShellComponent } from '../../../shared/components/auth-page-shell';

@Component({
  selector: 'app-forgot',
  standalone: true,
  imports: [
    AuthMessagesComponent,
    AuthPageShellComponent,
    ButtonModule,
    FloatLabelModule,
    InputTextModule,
    ReactiveFormsModule,
    RouterLink
  ],
  templateUrl: './forgot.component.html'
})
export class ForgotComponent {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly forgotService = inject(ForgotService);
  readonly forgotMutation = this.forgotService.useForgotPasswordMutation();

  forgotForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });
  messages = signal<AuthMessage[]>([]);
  formSubmitted = signal(false);

  onSubmit() {
    this.formSubmitted.set(true);

    if (this.forgotForm.valid) {
      const { email } = this.forgotForm.getRawValue();

      this.forgotMutation.mutate(
        { email },
        {
          onSuccess: (response) => {
            this.messages.set([
              {
                content: response.message,
                severity: 'success',
                icon: 'pi-check-circle'
              }
            ]);
          },
          onError: (error) => {
            this.messages.set([
              {
                content: error?.message || 'An error occurred. Please try again later.',
                severity: 'error',
                icon: 'pi-exclamation-circle'
              }
            ]);
          }
        }
      );
    }
  }
}
