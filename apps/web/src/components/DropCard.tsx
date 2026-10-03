'use client';

import type { Drop, DropStage } from '@fernleaf/shared';
import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useCan } from '@/lib/api';
import { formatTime } from '@/lib/format';

export const STAGES: Record<DropStage, { label: string; color: string }> = {
  cooking: { label: 'In the kitchen', color: 'gray' },
  'kitchen-ready': { label: 'Cooked', color: 'yellow' },
  'dispatch-ready': { label: 'Ready to go', color: 'blue' },
  out: { label: 'Out for delivery', color: 'violet' },
  delivered: { label: 'Delivered', color: 'green' },
};

// One drop: where it's going, what's in it and how far along it is.
// Shared by the dispatch board and the driver's phone view.
export function DropCard({ drop, children }: { drop: Drop; children?: ReactNode }) {
  const canOpenOrders = useCan('orders.view'); // drivers can't, so no dead links for them
  const stage = STAGES[drop.stage];
  const cooked = drop.orders.filter((o) => o.kitchenReady).length;
  return (
    <Card withBorder data-drop={`${drop.company.name} ${drop.ref.time}`}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <div>
          <Text fw={700} size="lg">
            {drop.ref.time} · {drop.company.name}
          </Text>
          <Text size="sm">{drop.address.label}</Text>
          <Text size="xs" c="dimmed">
            <a
              href={`https://maps.google.com/?q=${encodeURIComponent(drop.address.text)}`}
              target="_blank"
              rel="noreferrer"
            >
              {drop.address.text}
            </a>
          </Text>
        </div>
        <Stack gap={4} align="flex-end">
          <Badge color={stage.color}>{stage.label}</Badge>
          {drop.late && (
            <Badge color="red" variant="filled">
              {drop.stage === 'delivered' ? 'Delivered late' : 'Running late'}
            </Badge>
          )}
          {drop.deliveredOnTime && (
            <Badge color="green" variant="light">
              On time
            </Badge>
          )}
        </Stack>
      </Group>

      <Text size="xs" c="dimmed" mt="xs">
        {drop.orders.length} order{drop.orders.length === 1 ? '' : 's'}, {drop.portions} portions.{' '}
        {drop.stage === 'cooking' && `${cooked} of ${drop.orders.length} cooked. `}
        Leaves the kitchen by {formatTime(drop.dispatchReadyBy)}.
      </Text>
      {drop.driverInstructions && (
        <Text size="xs" mt={4}>
          📝 {drop.driverInstructions}
        </Text>
      )}
      <Stack gap={0} mt="xs">
        {drop.orders.map((order) => (
          <Text key={order.id} size="xs">
            {canOpenOrders ? <Link href={`/orders/${order.id}`}>#{order.id}</Link> : `#${order.id}`}{' '}
            {order.employee}: {order.items}
            {!order.kitchenReady && drop.stage === 'cooking' && (
              <Text span c="orange.8">
                {' '}
                (cooking)
              </Text>
            )}
          </Text>
        ))}
      </Stack>
      {drop.note && (
        <Text size="xs" mt={4} c="dimmed">
          Driver&apos;s note: {drop.note}
        </Text>
      )}
      {children}
    </Card>
  );
}
