import { Component } from '@angular/core';
import { RouterModule } from '@angular/router';

import { AppConfigurator } from './app.configurator';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [RouterModule, AppConfigurator],
  template: `
    <div>
      <main>
        <router-outlet></router-outlet>
      </main>
      <app-configurator location="landing" />
    </div>
  `
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AuthLayout {}
