'use client';

import type { Drop, DropStep } from '@fernleaf/shared';
import { Button, Group, Select, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DropCard, STAGES } from '@/components/DropCard';
import { api, useAction, useCan } from '@/lib/api';
import { formatDay, todayIST } from '@/lib/format';

// The one next step for a drop at each stage.
const NEXT: Partial<Record<Drop['stage'], { step: DropStep; label: string }>> = {
  'kitchen-ready': { step: 'dispatch-ready', label: 'Mark ready to go' },
  'dispatch-ready': { step: 'out', label: 'Send out for delivery' },
  out: { step: 'delivered', label: 'Mark delivered' },
};

function DropControls({ drop, drivers }: { drop: Drop; drivers: { id: number; name: string }[] }) {
  const canWork = useCan('dispatch.work');
  const options = { invalidate: ['drops'] };
  const assign = useAction(
    (driverId: number) => api('/dispatch/assign', { body: { drop: drop.ref, driverId } }),
    { ...options, success: 'Driver assigned' },
  );
  const step = useAction(
    (s: DropStep) => api('/dispatch/step', { body: { drop: drop.ref, step: s } }),
    options,
  );
  const next = NEXT[drop.stage];
  const left = drop.stage === 'out' || drop.stage === 'delivered';

  return (
    <Group mt="sm" justify="space-between">
      <Select
        size="xs"
        aria-label={`Driver for ${drop.company.name} ${drop.ref.time}`}
        placeholder="No driver"
        disabled={!canWork || left}
        data={drivers.map((d) => ({ value: String(d.id), label: d.name }))}
        value={drop.driver ? String(drop.driver.id) : null}
        onChange={(v) => v && assign.mutate(Number(v))}
        w={180}
      />
      {canWork && next && (
        <Button size="xs" loading={step.isPending} onClick={() => step.mutate(next.step)}>
          {next.label}
        </Button>
      )}
    </Group>
  );
}

export default function DispatchPage() {
  const [date, setDate] = useState(todayIST);
  const drops = useQuery({
    queryKey: ['drops', date],
    queryFn: () => api<Drop[]>(`/dispatch/drops?date=${date}`),
    refetchInterval: 30_000,
  });
  const drivers = useQuery({
    queryKey: ['drivers'],
    queryFn: () => api<{ id: number; name: string }[]>('/dispatch/drivers'),
  });
  const list = drops.data ?? [];
  const count = (stage: Drop['stage']) => list.filter((d) => d.stage === stage).length;

  return (
    <Stack>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Dispatch</Title>
          <Text size="sm" c="dimmed">
            {formatDay(date)}. Orders for the same company, address and time travel together as one
            drop.
          </Text>
        </div>
        <TextInput
          type="date"
          label="Delivery date"
          value={date}
          onChange={(e) => e.currentTarget.value && setDate(e.currentTarget.value)}
        />
      </Group>
      <Text size="sm">
        {(Object.keys(STAGES) as Drop['stage'][])
          .map((stage) => `${STAGES[stage].label}: ${count(stage)}`)
          .join(' · ')}
        {list.some((d) => d.late) && ` · Late: ${list.filter((d) => d.late).length}`}
      </Text>
      {list.length === 0 && <Text c="dimmed">No confirmed orders for this date.</Text>}
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {list.map((drop) => (
          <DropCard
            key={`${drop.ref.companyId}-${drop.ref.addressId}-${drop.ref.time}`}
            drop={drop}
          >
            <DropControls drop={drop} drivers={drivers.data ?? []} />
          </DropCard>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
