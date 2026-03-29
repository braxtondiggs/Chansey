import { Injectable, WritableSignal } from '@angular/core';
import { FormControl, FormGroup, Validators } from '@angular/forms';

import { MessageService } from 'primeng/api';

import { Exchange, ExchangeKey, ExchangeKeyHealthSummary } from '@chansey/api-interfaces';
import { queryKeys, useAuthMutation, useAuthQuery, FREQUENT_POLICY, STATIC_POLICY } from '@chansey/shared';

import { ExchangeFormState } from '../types/exchange-form.types';

type SaveExchangeKeysMutation = ReturnType<ExchangeService['useSaveExchangeKeysMutation']>;

/**
 * Service for exchange data via TanStack Query
 *
 * Uses centralized query keys and standardized caching policies.
 */
@Injectable({
  providedIn: 'root'
})
export class ExchangeService {
  /**
   * Query supported exchanges
   *
   * Uses STATIC policy since supported exchanges rarely change
   */
  useSupportedExchanges() {
    return useAuthQuery<Exchange[]>(queryKeys.exchanges.supported(), '/api/exchange?supported=true', {
      cachePolicy: STATIC_POLICY
    });
  }

  useExchangeHealth() {
    return useAuthQuery<ExchangeKeyHealthSummary[]>(queryKeys.exchanges.health(), '/api/exchange-keys/health', {
      cachePolicy: FREQUENT_POLICY
    });
  }

  useRecheckKeyMutation() {
    return useAuthMutation<ExchangeKeyHealthSummary, string>(
      (id: string) => `/api/exchange-keys/${id}/recheck`,
      'POST',
      {
        invalidateQueries: [queryKeys.exchanges.health()]
      }
    );
  }

  useSaveExchangeKeysMutation() {
    return useAuthMutation<ExchangeKey, Record<string, unknown>>('/api/exchange-keys', 'POST', {
      invalidateQueries: [queryKeys.auth.user(), queryKeys.profile.exchangeKeys()]
    });
  }

  useDeleteExchangeKeyMutation() {
    return useAuthMutation<ExchangeKey, string>((id: string) => `/api/exchange-keys/${id}`, 'DELETE', {
      invalidateQueries: [queryKeys.auth.user(), queryKeys.profile.exchangeKeys()]
    });
  }

  /**
   * Build exchange form state from exchanges and user data.
   * Merges with existing forms to preserve edit state.
   */
  buildExchangeForms(
    exchanges: Exchange[],
    userData: { exchanges?: ExchangeKey[] } | undefined,
    existingForms: Record<string, ExchangeFormState>
  ): Record<string, ExchangeFormState> {
    if (!exchanges || !userData) return existingForms;

    const updated = { ...existingForms };
    exchanges.forEach((exchange: Exchange) => {
      const slug = exchange.slug;
      const matchedKey = userData.exchanges?.find((key: ExchangeKey) => key.exchangeId === exchange.id);
      const isConnected = !!matchedKey;

      if (!updated[slug]) {
        updated[slug] = {
          form: new FormGroup({
            apiKey: new FormControl(
              { value: isConnected ? '••••••••••••••••••••••••' : '', disabled: isConnected },
              { nonNullable: true, validators: [Validators.required] }
            ),
            secretKey: new FormControl(
              { value: isConnected ? '••••••••••••••••••••••••' : '', disabled: isConnected },
              { nonNullable: true, validators: [Validators.required] }
            )
          }),
          connected: isConnected,
          loading: false,
          submitted: false,
          editMode: false,
          name: exchange.name,
          exchangeId: exchange.id,
          slug,
          connectedAt: matchedKey?.createdAt
        };
      } else if (!updated[slug].editMode) {
        updated[slug] = { ...updated[slug], connected: isConnected, connectedAt: matchedKey?.createdAt };
      }
    });
    return updated;
  }

  /**
   * Immutable update helper for exchange forms signal.
   */
  updateExchangeForm(
    formsSignal: WritableSignal<Record<string, ExchangeFormState>>,
    slug: string,
    updates: Partial<ExchangeFormState>
  ): void {
    formsSignal.update((current) => {
      if (!current[slug]) return current;
      return { ...current, [slug]: { ...current[slug], ...updates } };
    });
  }

  /**
   * Shared mutation flow for saving a new exchange key with success/error messaging.
   */
  saveNewExchangeKey(params: {
    mutation: SaveExchangeKeysMutation;
    exchangeObj: Exchange;
    formData: { apiKey: string; secretKey: string };
    formsSignal: WritableSignal<Record<string, ExchangeFormState>>;
    messageService: MessageService;
    onSuccess?: () => void;
  }): void {
    const { mutation, exchangeObj, formData, formsSignal, messageService, onSuccess } = params;
    const slug = exchangeObj.slug;

    const exchangeKeyDto = {
      exchangeId: exchangeObj.id,
      apiKey: formData.apiKey,
      secretKey: formData.secretKey,
      isActive: true
    };

    mutation.mutate(exchangeKeyDto, {
      onSuccess: ({ isActive }) => {
        this.updateExchangeForm(formsSignal, slug, { connected: true, loading: false, editMode: false });
        messageService.add({
          severity: isActive ? 'success' : 'error',
          summary: isActive ? 'Connection Successful' : 'Connection Failed',
          detail: isActive
            ? `Your ${exchangeObj.name} account has been connected successfully`
            : `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`
        });
        if (isActive) onSuccess?.();
      },
      onError: (error: Error & { status?: number; error?: { message?: string } }) => {
        this.updateExchangeForm(formsSignal, slug, { loading: false });
        const detail =
          error.status === 409
            ? 'You already have API keys for this exchange. Please remove the existing keys before adding new ones.'
            : error.error?.message ||
              `Failed to connect to ${exchangeObj.name}. Please check your API keys and try again.`;
        messageService.add({ severity: 'error', summary: 'Connection Failed', detail });
      }
    });
  }
}
