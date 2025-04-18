import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { BehaviorSubject, Observable, tap } from 'rxjs';

import { IRegisterResponse } from '@chansey/api-interfaces';

@Injectable({
  providedIn: 'root'
})
export class RegisterService {
  private userSubject = new BehaviorSubject<any>(null);
  user$ = this.userSubject.asObservable();

  constructor(private http: HttpClient) {}

  register(
    email: string,
    password: string,
    confirm_password: string,
    given_name: string,
    family_name: string
  ): Observable<IRegisterResponse> {
    return this.http
      .post<IRegisterResponse>('api/auth/register', {
        email,
        password,
        confirm_password,
        given_name,
        family_name
      })
      .pipe(
        tap((response) => {
          // Save token and user data
          this.userSubject.next(response.message);
        })
      );
  }
}
