import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, Observable, tap } from 'rxjs';

import { IRegisterResponse } from '@chansey/api-interfaces';

@Injectable({
    providedIn: 'root',
})
export class RegisterService {
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

    register(
        email: string,
        password: string,
        given_name: string,
        family_name: string
    ): Observable<IRegisterResponse> {
        return this.http
            .post<IRegisterResponse>('api/auth/register', {
                email,
                password,
                given_name,
                family_name,
            })
            .pipe(
                tap((response) => {
                    // Save token and user data
                    this.userSubject.next(response.message);
                })
            );
    }
}
