import { CommonModule } from '@angular/common';
import { Component, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { FloatLabelModule } from 'primeng/floatlabel';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { LazyImageComponent } from '@chansey-web/app/components/lazy-image.component';

import { ForgotService } from './forgot.service';

@Component({
  selector: 'app-forgot',
  standalone: true,
  imports: [
    CommonModule,
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
  forgotForm: FormGroup;
  isLoading = false;
  messages = signal<any[]>([]);
  formSubmitted = false;

  constructor(
    private fb: FormBuilder,
    private forgotService: ForgotService
  ) {
    this.forgotForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  onSubmit() {
    this.formSubmitted = true;

    if (this.forgotForm.valid) {
      this.isLoading = true;

      const { email } = this.forgotForm.value;

      this.forgotService.forgot(email).subscribe({
        next: (response) => {
          this.isLoading = false;
          this.messages.set([
            {
              content: response.message,
              severity: 'success',
              icon: 'pi-check-circle'
            }
          ]);
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
          console.error('Login error:', error);
        }
      });
    }
  }
}
