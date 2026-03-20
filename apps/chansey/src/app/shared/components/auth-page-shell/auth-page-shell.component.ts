import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { APP_NAME } from '@chansey/api-interfaces';

import {
  ForgotIllustrationComponent,
  LoginIllustrationComponent,
  RegisterIllustrationComponent
} from '../auth-illustrations';
import { LazyImageComponent } from '../lazy-image/lazy-image.component';

@Component({
  selector: 'app-auth-page-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    LazyImageComponent,
    LoginIllustrationComponent,
    RegisterIllustrationComponent,
    ForgotIllustrationComponent
  ],
  template: `
    <section
      class="mx-auto flex min-h-screen animate-fadein items-center justify-center animate-duration-300 animate-ease-in lg:items-start"
    >
      <div class="flex h-full w-full gap-12 lg:gap-0">
        <div class="flex w-full flex-col p-20 lg:w-1/2 lg:min-w-160">
          <a routerLink="/" class="mb-8 flex items-center justify-center">
            <app-lazy-image
              className="object-contain object-left w-auto h-24 -translate-y-3"
              src="/public/icon.png"
              [alt]="appName + ' logo'"
              [width]="114"
              [height]="96"
            />
            <h5 class="title-h5 font-normal whitespace-nowrap">{{ appName }}</h5>
          </a>
          <div class="flex grow flex-col justify-center">
            <div class="mx-auto w-full max-w-md">
              <ng-content />
            </div>
          </div>
        </div>
        <div class="landing-container hidden h-screen w-full py-10 lg:flex lg:w-1/2 lg:items-center lg:justify-center">
          <div class="flex h-full w-full max-w-xl items-center justify-center overflow-hidden px-10">
            @switch (illustration()) {
              @case ('login') {
                <app-login-illustration />
              }
              @case ('register') {
                <app-register-illustration />
              }
              @case ('forgot') {
                <app-forgot-illustration />
              }
            }
          </div>
        </div>
      </div>
    </section>
  `
})
export class AuthPageShellComponent {
  readonly appName = APP_NAME;
  illustration = input<'login' | 'register' | 'forgot'>('login');
}
