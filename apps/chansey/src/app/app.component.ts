import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';

import { Message } from '@chansey/api-interfaces';

@Component({
  selector: 'chansey-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  hello$ = this.http.get<Message>('/api/hello');
  constructor(private http: HttpClient) { }
}
