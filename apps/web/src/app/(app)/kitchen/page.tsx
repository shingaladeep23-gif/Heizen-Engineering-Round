'use client';

import type { KitchenBoard, KitchenUnit, UnitState } from '@fernleaf/shared';
import {
  Badge,
  Button,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Stat } from '@/components/Stat';
import { api, useAction, useCan } from '@/lib/api';
import { formatDay, formatTime } from '@/lib/format';

const todayIST = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const STATE: Record<UnitState, { label: string; color: string; row?: string }> = {
  late: { label: 'Late', color: 'red', row: 'var(--mantine-color-red-0)' },
  'at-risk': { label: 'At risk', color: 'orange', row: 'var(--mantine-color-orange-0)' },
  todo: { label: 'To do', color: 'gray' },
  cooking: { label: 'Cooking', color: 'blue' },
  done: { label: 'Done', color: 'green' },
  waiting: { label: 'Not confirmed yet', color: 'gray' },
};

function UnitRow({ unit, date }: { unit: KitchenUnit; date: string }) {
  const canWork = useCan('kitchen.work');
  const options = { invalidate: ['kitchen'] };
  const start = useAction(
    () => api(`/kitchen/units/${unit.id}/start`, { method: 'POST' }),
    options,
  );
  const done = useAction(() => api(`/kitchen/units/${unit.id}/done`, { method: 'POST' }), options);
  const state = STATE[unit.state];
  const workable = canWork && unit.orderStatus === 'CONFIRMED' && !unit.doneAt;

  return (
    <Table.Tr style={{ background: state.row }} data-unit={unit.id}>
      <Table.Td fw={600}>{formatTime(unit.kitchenReadyBy)}</Table.Td>
      <Table.Td>
        <Text fw={600} size="sm">
          {unit.quantity} × {unit.dishName}
        </Text>
        <Text size="xs" c="dimmed">
          {unit.choices || 'No choices'}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="sm">
          <Link href={`/orders/${unit.orderId}?from=kitchen&date=${date}`}>#{unit.orderId}</Link>{' '}
          {unit.company}
        </Text>
        <Text size="xs" c="dimmed">
          Delivery {unit.deliveryTime}
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge color={state.color} variant={unit.state === 'late' ? 'filled' : 'light'}>
          {state.label}
        </Badge>
      </Table.Td>
      <Table.Td>
        {workable && (
          <Group gap="xs" wrap="nowrap">
            {!unit.startedAt && (
              <Button
                size="compact-sm"
                variant="light"
                loading={start.isPending}
                onClick={() => start.mutate(undefined)}
              >
                Start
              </Button>
            )}
            <Button
              size="compact-sm"
              loading={done.isPending}
              onClick={() => done.mutate(undefined)}
            >
              Done
            </Button>
          </Group>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

export default function KitchenPage() {
  const [date, setDate] = useState(todayIST);
  const [station, setStation] = useState('All');
  // Refreshes on its own so a screen on the kitchen wall stays current.
  const board = useQuery({
    queryKey: ['kitchen', date],
    queryFn: () => api<KitchenBoard>(`/kitchen?date=${date}`),
    refetchInterval: 30_000,
  });

  const units = board.data?.units ?? [];
  const stations = ['All', ...new Set(units.map((u) => u.station).sort())];
  const shown = station === 'All' ? units : units.filter((u) => u.station === station);
  const count = (state: UnitState) => shown.filter((u) => u.state === state).length;
  const portions = (list: KitchenUnit[]) => list.reduce((sum, u) => sum + u.quantity, 0);

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Kitchen board</Title>
          <Text size="sm" c="dimmed">
            {formatDay(date)}. Each row is one prep unit: a dish with one set of choices.
          </Text>
        </div>
        <TextInput
          type="date"
          label="Delivery date"
          value={date}
          onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)}
        />
      </Group>

      <SimpleGrid cols={{ base: 2, sm: 3, md: 6 }}>
        <Stat label="Late" value={count('late')} color="red" />
        <Stat label="At risk" value={count('at-risk')} color="orange" />
        <Stat label="To do" value={count('todo')} />
        <Stat label="Cooking" value={count('cooking')} color="blue" />
        <Stat label="Done" value={count('done')} color="green" />
        <Stat
          label="Portions left"
          value={portions(shown.filter((u) => !u.doneAt && u.state !== 'waiting'))}
        />
      </SimpleGrid>

      <SegmentedControl data={stations} value={station} onChange={setStation} />

      {shown.length === 0 ? (
        <Text c="dimmed">
          Nothing to cook for this date{station === 'All' ? '' : ` at ${station}`}.
        </Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Ready by</Table.Th>
              <Table.Th>What</Table.Th>
              <Table.Th>Order</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {shown.map((unit) => (
              <UnitRow key={unit.id} unit={unit} date={date} />
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
