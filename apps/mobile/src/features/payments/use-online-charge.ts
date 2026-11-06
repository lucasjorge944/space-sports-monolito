import type { PayOnlineInput, PlayerOnlineCharge } from '@space-sports/api-client';
import { paymentLayout } from '@space-sports/ui-tokens';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { syncServerClock } from './countdown';
import { retryUnknownOutcome } from './idempotency';
import {
  chargeQueryKey,
  createCharge,
  fetchCharge,
  invalidateAfterPayment,
  type Payable,
} from './payable';

/**
 * Cobrança do item com a atualização da tela de pagamento (docs/05, "Atualização do status"):
 * consulta a cada 5 s com a tela em foco enquanto `poll`, consulta na hora ao voltar ao app (a volta
 * do app do banco) e acerta o relógio pelo `serverTime` de cada resposta.
 */
export function useOnlineCharge(
  payable: Payable,
  { poll }: { poll: (charge: PlayerOnlineCharge | null | undefined) => boolean },
) {
  const focused = useIsFocused();
  const query = useQuery({
    queryKey: chargeQueryKey(payable),
    queryFn: async ({ signal }) => {
      const charge = await fetchCharge(payable, signal);
      syncServerClock(charge?.serverTime);
      return charge;
    },
    refetchInterval: (q) => (focused && poll(q.state.data) ? paymentLayout.pollIntervalMs : false),
    refetchIntervalInBackground: false,
  });

  const { refetch } = query;
  useEffect(() => {
    if (!focused) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch();
    });
    return () => subscription.remove();
  }, [focused, refetch]);

  // "Sem conexão" depois de duas falhas seguidas (a consulta continua tentando).
  const [failures, setFailures] = useState(0);
  useEffect(() => {
    if (query.errorUpdatedAt > query.dataUpdatedAt) setFailures((n) => n + 1);
    else setFailures(0);
  }, [query.errorUpdatedAt, query.dataUpdatedAt]);
  const offline = query.isError && failures >= 2;

  return { query, charge: query.data, offline };
}

export interface CreateChargeVariables {
  input: PayOnlineInput;
  /** `Idempotency-Key` da tentativa (nova a cada toque). */
  key: string;
}

/**
 * Criação da cobrança: grava a resposta no cache da consulta (a tela troca de estado na hora) e
 * repete sozinha, com a mesma chave, só quando o resultado é desconhecido (rede).
 */
export function useCreateCharge(
  payable: Payable,
  callbacks: {
    onSuccess?: (charge: PlayerOnlineCharge) => void;
    onError?: (error: unknown) => void;
  } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, key }: CreateChargeVariables) => createCharge(payable, input, key),
    retry: retryUnknownOutcome,
    retryDelay: 1500,
    onSuccess: (charge) => {
      syncServerClock(charge.serverTime);
      queryClient.setQueryData(chargeQueryKey(payable), charge);
      // A resposta já é a cobrança atual: só o item e as listas são relidos.
      invalidateAfterPayment(queryClient, payable, { charge: false });
      callbacks.onSuccess?.(charge);
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: chargeQueryKey(payable) });
      callbacks.onError?.(error);
    },
  });
}
