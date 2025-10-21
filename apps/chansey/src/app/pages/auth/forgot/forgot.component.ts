
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { LazyImageComponent } from '@chansey-web/app/shared/components/lazy-image/lazy-image.component';

import { ForgotService } from './forgot.service';

@Component({
  selector: 'app-forgot',
  standalone: true,
  imports: [
    ButtonModule,
    FloatLabelModule,
    InputTextModule,
    LazyImageComponent,
    MessageModule,
    ReactiveFormsModule,
    RouterLink
],
  templateUrl: './forgot.component.html'
})
export class ForgotComponent {
  private readonly fb = inject(FormBuilder);
  private readonly forgotService = inject(ForgotService);
  readonly forgotMutation = this.forgotService.useForgotPasswordMutation();

  forgotForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]]
  });
  messages = signal<any[]>([]);
  formSubmitted = false;

  onSubmit() {
    this.formSubmitted = true;

    if (this.forgotForm.valid) {
      const { email } = this.forgotForm.value;

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
            console.error('Forgot password error:', error);
          }
        }
      );
    }
  }
}
