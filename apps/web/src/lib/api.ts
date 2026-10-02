import { can, type ApiErrorBody, type Lists, type Me, type Permission } from '@fernleaf/shared';
import type { UseFormReturnType } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  readonly fieldErrors: Record<string, string>;

  constructor(
    readonly status: number,
    body: ApiErrorBody | null,
  ) {
    super(body?.message ?? 'Something went wrong, please try again');
    this.fieldErrors = body?.fieldErrors ?? {};
  }
}

// Every call goes to /api/..., which Next.js forwards to the NestJS API.
export async function api<T>(path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });

// For showing or hiding controls. The API enforces the real rule.
export function useCan(permission: Permission) {
  const { data: me } = useMe();
  return !!me && can(me.role, permission);
}

export const useLists = () =>
  useQuery({ queryKey: ['lists'], queryFn: () => api<Lists>('/lists') });

/**
 * A mutation with the usual extras: refresh the listed queries, show a
 * success toast, and on failure show the error and put field errors on the form.
 */
export function useAction<TVars, TResult = unknown>(
  fn: (vars: TVars) => Promise<TResult>,
  options: {
    invalidate?: string[];
    success?: string;
    onSuccess?: (result: TResult) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form?: UseFormReturnType<any>;
  } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      if (options.success) notifications.show({ color: 'green', message: options.success });
      options.invalidate?.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      options.onSuccess?.(result);
    },
    onError: (error) => {
      options.form?.setErrors(error instanceof ApiError ? error.fieldErrors : {});
      notifications.show({ color: 'red', message: error.message });
    },
  });
}
