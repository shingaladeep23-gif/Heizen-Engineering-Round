import type { ApiErrorBody, Me } from '@fernleaf/shared';
import { useQuery } from '@tanstack/react-query';

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
  useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/auth/me'),
    retry: false,
  });
