'use client';

import type { KitchenBoard, KitchenUnit } from '@fernleaf/shared';
import { Button, Card, Group, Loader, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Stat } from '@/components/Stat';
import { api } from '@/lib/api';
import { formatDay, formatTime } from '@/lib/format';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const tomorrowIST = () =>
  new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
const portions = (units: KitchenUnit[]) => units.reduce((s, u) => s + u.quantity, 0);

// What a kitchen lead needs at 6am: how much, of what, at which station, and
// what's already slipping. Built from the kitchen board's own data.
export function KitchenDashboard() {
  const today = useQuery({
    queryKey: ['kitchen', todayIST()],
    queryFn: () => api<KitchenBoard>(`/kitchen?date=${todayIST()}`),
    refetchInterval: 60_000,
  });
  const tomorrow = useQuery({
    queryKey: ['kitchen', tomorrowIST()],
    queryFn: () => api<KitchenBoard>(`/kitchen?date=${tomorrowIST()}`),
  });
  if (!today.data) return <Loader />;

  // Only confirmed work counts for today; placed orders aren't final yet.
  const units = today.data.units.filter((u) => u.state !== 'waiting');
  const left = units.filter((u) => !u.doneAt);
  const stations = [...new Set(units.map((u) => u.station))].sort();

  // The prep list: identical dish + choices added up across orders.
  const prep = new Map<string, number>();
  for (const u of left) {
    const key = u.choices ? `${u.dishName} (${u.choices})` : u.dishName;
    prep.set(key, (prep.get(key) ?? 0) + u.quantity);
  }
  const prepList = [...prep.entries()].sort((a, b) => b[1] - a[1]);
  const nextUp = left.slice(0, 5);

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Kitchen dashboard</Title>
        <Button component={Link} href="/kitchen">
          Open the kitchen board
        </Button>
      </Group>
      <Text c="dimmed" size="sm">
        {formatDay(today.data.date)}
      </Text>

      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat label="Portions today" value={portions(units)} hint={`${units.length} prep units`} />
        <Stat label="Portions still to cook" value={portions(left)} />
        <Stat
          label="Late units"
          value={units.filter((u) => u.state === 'late').length}
          color="red"
        />
        <Stat
          label="At risk"
          value={units.filter((u) => u.state === 'at-risk').length}
          color="orange"
        />
      </SimpleGrid>

      <Group align="flex-start" grow>
        <Card withBorder>
          <Title order={5} mb="xs">
            By station
          </Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Station</Table.Th>
                <Table.Th ta="right">Portions left</Table.Th>
                <Table.Th ta="right">Late</Table.Th>
                <Table.Th ta="right">At risk</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {stations.map((station) => {
                const here = units.filter((u) => u.station === station);
                return (
                  <Table.Tr key={station}>
                    <Table.Td>{station}</Table.Td>
                    <Table.Td ta="right">{portions(here.filter((u) => !u.doneAt))}</Table.Td>
                    <Table.Td ta="right">{here.filter((u) => u.state === 'late').length}</Table.Td>
                    <Table.Td ta="right">
                      {here.filter((u) => u.state === 'at-risk').length}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
        <Card withBorder>
          <Title order={5} mb="xs">
            Prep list: still to cook today
          </Title>
          <Table>
            <Table.Tbody>
              {prepList.map(([what, count]) => (
                <Table.Tr key={what}>
                  <Table.Td>{what}</Table.Td>
                  <Table.Td ta="right" fw={600}>
                    {count}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {prepList.length === 0 && <Text c="dimmed">Nothing left to cook.</Text>}
        </Card>
      </Group>

      <Card withBorder>
        <Title order={5} mb="xs">
          Next up
        </Title>
        {nextUp.map((u) => (
          <Text key={u.id} size="sm">
            {formatTime(u.kitchenReadyBy)}: {u.quantity} × {u.dishName}
            {u.choices && ` (${u.choices})`} for {u.company}
          </Text>
        ))}
        {nextUp.length === 0 && <Text c="dimmed">All done for today.</Text>}
        <Text size="xs" c="dimmed" mt="xs">
          Tomorrow so far:{' '}
          {tomorrow.data ? `${portions(tomorrow.data.units)} portions (confirmed and placed)` : '…'}
        </Text>
      </Card>
    </Stack>
  );
}
