import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ButtonModule } from 'primeng/button';

@Component({
  selector: 'app-empty-state',
  imports: [ButtonModule, RouterLink],
  template: `
    <div class="flex flex-col items-center justify-center px-4 py-12 text-center">
      @if (icon()) {
        <div class="bg-primary/10 mb-4 rounded-full p-4">
          <i [class]="'text-primary pi pi-' + icon() + ' !text-4xl'" aria-hidden="true"></i>
        </div>
      }
      @if (title()) {
        <h3 class="mb-2 text-xl font-semibold text-gray-700 dark:text-gray-300">{{ title() }}</h3>
      }
      @if (message()) {
        <p class="mb-6 max-w-md text-gray-500 dark:text-gray-400">{{ message() }}</p>
      }
      @if (actionRoute()) {
        <p-button
          [icon]="actionIcon()"
          [label]="actionLabel()"
          [routerLink]="actionRoute()"
          [queryParams]="actionQueryParams()"
          [outlined]="outlined()"
          [size]="size()"
        />
      }
      <ng-content />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmptyStateComponent {
  readonly icon = input<string>();
  readonly title = input<string>();
  readonly message = input<string>();
  readonly actionLabel = input<string>();
  readonly actionRoute = input<string>();
  readonly actionQueryParams = input<Record<string, string>>();
  readonly actionIcon = input<string>();
  readonly outlined = input(false);
  readonly size = input<'small' | 'large'>('small');
}
