'use client';

import { MantineProvider } from '@mantine/core';
import { Notifications, notifications } from '@mantine/notifications';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  // Retry blips (network, server errors) once, but not "no access" or "not
  // found": those won't change on a retry, and the user should see why.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // Any page whose data fails to load says so, instead of looking empty.
        // (401 is left out: the layout already sends you to the login page.)
        queryCache: new QueryCache({
          onError: (error) => {
            if (error instanceof ApiError && error.status === 401) return;
            notifications.show({ color: 'red', message: `Couldn't load: ${error.message}` });
          },
        }),
        defaultOptions: {
          queries: {
            retry: (failures, error) =>
              !(error instanceof ApiError && error.status < 500) && failures < 1,
          },
        },
      }),
  );
  return (
    <MantineProvider>
      {/* Top centre: bottom right is where many action buttons are, and a
          toast there would cover the very button you need after an error. */}
      <Notifications position="top-center" />
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}
