import { Injectable } from '@angular/core';

import { Algorithm, AlgorithmStrategy, CreateAlgorithmDto, UpdateAlgorithmDto } from '@chansey/api-interfaces';

import { algorithmKeys } from '../../../core/query/query.keys';
import { useAuthQuery, useAuthMutation } from '../../../core/query/query.utils';

@Injectable({
  providedIn: 'root'
})
export class AlgorithmsService {
  private apiUrl = '/api/algorithm';

  useAlgorithms() {
    return useAuthQuery<Algorithm[]>(algorithmKeys.lists.all, this.apiUrl);
  }

  useStrategies() {
    return useAuthQuery<AlgorithmStrategy[]>(algorithmKeys.strategies, `${this.apiUrl}/strategies`);
  }

  useAlgorithm() {
    return useAuthQuery<Algorithm, string>(
      (id: string) => algorithmKeys.detail(id),
      (id: string) => `${this.apiUrl}/${id}`
    );
  }

  useCreateAlgorithm() {
    return useAuthMutation<Algorithm, CreateAlgorithmDto>(this.apiUrl, 'POST', {
      invalidateQueries: [algorithmKeys.lists.all]
    });
  }

  useUpdateAlgorithm() {
    return useAuthMutation<Algorithm, UpdateAlgorithmDto>((variables) => `${this.apiUrl}/${variables.id}`, 'PATCH', {
      invalidateQueries: [algorithmKeys.lists.all]
    });
  }

  useDeleteAlgorithm() {
    return useAuthMutation<void, string>((id: string) => `${this.apiUrl}/${id}`, 'DELETE', {
      invalidateQueries: [algorithmKeys.lists.all]
    });
  }
}
