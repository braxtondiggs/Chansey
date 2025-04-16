import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';

import { IForgotPassword } from '@chansey/api-interfaces';

@Injectable({
    providedIn: 'root',
})
export class ForgotService {
    private userSubject = new BehaviorSubject<any>(null);
    user$ = this.userSubject.asObservable();

    constructor(
        private http: HttpClient,
        private router: Router
    ) {
        // Check if user is already logged in
        const savedUser = localStorage.getItem('user');
        if (savedUser) {
            this.userSubject.next(JSON.parse(savedUser));
        }
    }

    forgot(email: string): Observable<IForgotPassword> {
        return this.http
            .post<IForgotPassword>('api/auth/forgot', {
                email,
            })
            .pipe(
                tap((response) => {
                    this.userSubject.next(response.email);
                })
            );
    }
}
