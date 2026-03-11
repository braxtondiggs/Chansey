import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { take, timer } from 'rxjs';

import { VerifyEmailService } from './verify-email.service';

import { AuthMessage, AuthMessagesComponent } from '../../../shared/components/auth-messages';
import { AuthPageShellComponent } from '../../../shared/components/auth-page-shell';
import { AUTH_REDIRECT_DELAY } from '../auth.constants';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [AuthMessagesComponent, AuthPageShellComponent, ButtonModule, ProgressSpinnerModule, RouterLink],
  templateUrl: './verify-email.component.html'
})
export class VerifyEmailComponent {
  private readonly verifyEmailService = inject(VerifyEmailService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  readonly verifyEmailMutation = this.verifyEmailService.useVerifyEmailMutation();

  messages = signal<AuthMessage[]>([]);
  isVerifying = signal(true);
  isSuccess = signal(false);

  constructor() {
    this.route.queryParams.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const token = params['token'];

      if (!token) {
        this.isVerifying.set(false);
        this.messages.set([
          {
            content: 'Invalid or missing verification token.',
            severity: 'error',
            icon: 'pi-exclamation-circle'
          }
        ]);
        return;
      }

      this.verifyEmail(token);
    });
  }

  private verifyEmail(token: string) {
    this.verifyEmailMutation.mutate(
      { token },
      {
        onSuccess: (response) => {
          this.isVerifying.set(false);
          this.isSuccess.set(true);
          this.messages.set([
            {
              content: response.message || 'Your email has been verified successfully!',
              severity: 'success',
              icon: 'pi-check-circle'
            }
          ]);
          timer(AUTH_REDIRECT_DELAY)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(() => this.router.navigate(['/login']));
        },
        onError: (error: Error & { message?: string }) => {
          this.isVerifying.set(false);
          this.messages.set([
            {
              content: error?.message || 'Failed to verify email. The link may have expired.',
              severity: 'error',
              icon: 'pi-exclamation-circle'
            }
          ]);
        }
      }
    );
  }
}
