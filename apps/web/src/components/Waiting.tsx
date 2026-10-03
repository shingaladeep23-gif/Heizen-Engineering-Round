import { Alert, Loader } from '@mantine/core';

// While a page's data loads: a spinner, or the reason it failed (e.g. "You
// don't have access to this"), never a spinner that spins forever.
export function Waiting({ error }: { error: Error | null }) {
  return error ? (
    <Alert color="red" title="Couldn't load this">
      {error.message}
    </Alert>
  ) : (
    <Loader />
  );
}
