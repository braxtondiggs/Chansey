import { Injectable } from '@angular/core';

import { Risk, CreateRisk, UpdateRisk } from '@chansey/api-interfaces';

import { riskKeys } from '@chansey-web/app/core/query/query.keys';
import { useAuthQuery, useAuthMutation } from '@chansey-web/app/core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class RisksService {
  private apiUrl = '/api/risk';

  useRisks() {
    return useAuthQuery<Risk[]>(riskKeys.lists.all, this.apiUrl);
  }

  useRisk() {
    return useAuthQuery<Risk, string>(
      (id: string) => riskKeys.detail(id),
      (id: string) => `${this.apiUrl}/${id}`
    );
  }

  useCreateRisk() {
    return useAuthMutation<Risk, CreateRisk>(this.apiUrl, 'POST', {
      invalidateQueries: [riskKeys.lists.all]
    });
  }

  useUpdateRisk() {
    return useAuthMutation<Risk, UpdateRisk>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [riskKeys.lists.all]
    });
  }

  useDeleteRisk() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [riskKeys.lists.all]
    });
  }
}
