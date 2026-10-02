'use client';

import { Center, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';

export default function Home() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () => fetch('/api/health').then((r) => r.json()),
  });
  return (
    <Center h="100vh">
      <Text>
        API: {health.isPending ? 'checking…' : health.data?.ok ? 'up' : 'down'}
      </Text>
    </Center>
  );
}
