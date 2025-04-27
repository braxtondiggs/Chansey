import { Component, OnInit } from '@angular/core';
import { RouterModule } from '@angular/router';

import { TitleService } from './services/title.service';

@Component({
  selector: 'app-root',
  template: `<router-outlet></router-outlet>`,
  imports: [RouterModule],
  standalone: true
})
export class AppComponent implements OnInit {
  constructor(private titleService: TitleService) {}

  ngOnInit() {
    this.titleService.init();
  }
}
