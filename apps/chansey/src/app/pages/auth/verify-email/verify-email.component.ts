import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinnerModule } from 'primeng/progressspinner';

import { VerifyEmailService } from './verify-email.service';

import { LazyImageComponent } from '../../../shared/components/lazy-image/lazy-image.component';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [ButtonModule, LazyImageComponent, MessageModule, ProgressSpinnerModule, RouterLink],
  templateUrl: './verify-email.component.html'
})
export class VerifyEmailComponent implements OnInit {
  private verifyEmailService = inject(VerifyEmailService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  readonly verifyEmailMutation = this.verifyEmailService.useVerifyEmailMutation();

  messages = signal<{ content: string; severity: any; icon: string }[]>([]);
  isVerifying = signal(true);
  isSuccess = signal(false);

  ngOnInit() {
    this.route.queryParams.subscribe((params) => {
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
          setTimeout(() => {
            this.router.navigate(['/login']);
          }, 3000);
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
