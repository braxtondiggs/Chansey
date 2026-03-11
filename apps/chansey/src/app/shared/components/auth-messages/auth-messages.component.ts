import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import { MessageModule } from 'primeng/message';

import { AuthMessage } from './auth-message.interface';

@Component({
  selector: 'app-auth-messages',
  standalone: true,
  imports: [MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col">
      @for (message of messages(); track message.content) {
        <p-message
          [severity]="message.severity"
          [text]="message.content"
          [icon]="'pi ' + message.icon"
          size="large"
          class="mt-4"
        />
      }
    </div>
  `
})
export class AuthMessagesComponent {
  messages = input.required<AuthMessage[]>();
}
