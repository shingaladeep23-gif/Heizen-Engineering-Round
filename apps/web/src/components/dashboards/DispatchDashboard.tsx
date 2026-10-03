'use client';

import type { Drop } from '@fernleaf/shared';
import { Button, Card, Group, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { STAGES } from '@/components/DropCard';
import { Stat } from '@/components/Stat';
import { Waiting } from '@/components/Waiting';
import { api } from '@/lib/api';
import { formatClock, formatTime, todayIST } from '@/lib/format';

// What a dispatcher needs: what's leaving next, what's slipping, and who's
// driving what. Built from the dispatch board's own data.
export function DispatchDashboard() {
  const query = useQuery({
    queryKey: ['drops', todayIST()],
    queryFn: () => api<Drop[]>(`/dispatch/drops?date=${todayIST()}`),
    refetchInterval: 60_000,
  });
  if (!query.data) return <Waiting error={query.error} />;
  const drops = query.data;
  const delivered = drops.filter((d) => d.stage === 'delivered');
  const waiting = drops
    .filter((d) => d.stage !== 'out' && d.stage !== 'delivered')
    .sort((a, b) => a.dispatchReadyBy.localeCompare(b.dispatchReadyBy));
  const noDriver = drops.filter((d) => !d.driver && d.stage !== 'delivered');
  const drivers = new Map<string, { drops: number; done: number }>();
  for (const d of drops) {
    const name = d.driver?.name ?? 'No driver yet';
    const row = drivers.get(name) ?? { drops: 0, done: 0 };
    drivers.set(name, { drops: row.drops + 1, done: row.done + (d.stage === 'delivered' ? 1 : 0) });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Dispatch dashboard</Title>
        <Button component={Link} href="/dispatch">
          Open the dispatch board
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat label="Drops today" value={drops.length} />
        <Stat label="Out on the road" value={drops.filter((d) => d.stage === 'out').length} />
        <Stat
          label="Delivered"
          value={delivered.length}
          hint={`${delivered.filter((d) => d.deliveredOnTime).length} on time`}
        />
        <Stat label="Running late" value={drops.filter((d) => d.late).length} color="red" />
      </SimpleGrid>

      {noDriver.length > 0 && (
        <Card withBorder style={{ borderColor: 'var(--mantine-color-orange-5)' }}>
          <Text fw={600}>Drops without a driver: {noDriver.length}</Text>
          {noDriver.map((d) => (
            <Text key={`${d.company.id}-${d.ref.time}-${d.address.id}`} size="sm">
              {formatClock(d.ref.time)} {d.company.name}, {d.address.label}
            </Text>
          ))}
        </Card>
      )}

      <Group align="flex-start" grow>
        <Card withBorder>
          <Title order={5} mb="xs">
            Leaving next
          </Title>
          <Table>
            <Table.Tbody>
              {waiting.slice(0, 6).map((d) => (
                <Table.Tr key={`${d.company.id}-${d.ref.time}-${d.address.id}`}>
                  <Table.Td>{formatTime(d.dispatchReadyBy)}</Table.Td>
                  <Table.Td>
                    {d.company.name}, {d.address.label}
                  </Table.Td>
                  <Table.Td>{STAGES[d.stage].label}</Table.Td>
                  <Table.Td c={d.late ? 'red' : undefined}>{d.late ? 'Late' : ''}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {waiting.length === 0 && <Text c="dimmed">Everything has left the kitchen.</Text>}
        </Card>
        <Card withBorder>
          <Title order={5} mb="xs">
            Drivers today
          </Title>
          <Table>
            <Table.Tbody>
              {[...drivers.entries()].map(([name, row]) => (
                <Table.Tr key={name}>
                  <Table.Td>{name}</Table.Td>
                  <Table.Td ta="right">
                    {row.done} of {row.drops} drops delivered
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Group>
    </Stack>
  );
}
