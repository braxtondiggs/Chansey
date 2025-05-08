import { Injectable } from '@angular/core';

import { IRegister, IRegisterResponse } from '@chansey/api-interfaces';

import { useAuthMutation } from '@chansey-web/app/core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class RegisterService {
  useRegisterMutation() {
    return useAuthMutation<IRegisterResponse, IRegister>('/api/auth/register', 'POST');
  }
}
