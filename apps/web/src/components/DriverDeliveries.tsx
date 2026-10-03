'use client';

import type { Drop } from '@fernleaf/shared';
import { Button, FileInput, Modal, Stack, Text, Textarea, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { DropCard } from '@/components/DropCard';
import { api, useAction } from '@/lib/api';
import { shrinkPhoto } from '@/lib/photo';

function DeliverDialog({ drop, onClose }: { drop: Drop; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const deliver = useAction(
    async () =>
      api('/deliveries/delivered', {
        body: { drop: drop.ref, note, photo: photo ? await shrinkPhoto(photo) : null },
      }),
    { success: 'Marked delivered. Thank you!', invalidate: ['deliveries'], onSuccess: onClose },
  );
  return (
    <Stack>
      <Text size="sm">
        {drop.company.name}, {drop.address.label}
      </Text>
      <Textarea
        label="Note (optional)"
        placeholder="e.g. Left with reception"
        value={note}
        onChange={(e) => setNote(e.currentTarget.value)}
      />
      <FileInput
        label="Photo (optional)"
        placeholder="Take or choose a photo"
        accept="image/*"
        capture="environment"
        clearable
        value={photo}
        onChange={setPhoto}
      />
      <Button size="lg" loading={deliver.isPending} onClick={() => deliver.mutate(undefined)}>
        Confirm delivered
      </Button>
    </Stack>
  );
}

// A driver's day: only their own drops, in time order, built for a phone.
export function DriverDeliveries() {
  const drops = useQuery({
    queryKey: ['deliveries'],
    queryFn: () => api<Drop[]>('/deliveries'),
    refetchInterval: 60_000,
  });
  const [delivering, setDelivering] = useState<Drop | null>(null);
  const list = drops.data ?? [];
  const left = list.filter((d) => d.stage !== 'delivered').length;

  return (
    <Stack>
      <div>
        <Title order={2}>Today&apos;s deliveries</Title>
        <Text c="dimmed" size="sm">
          {list.length === 0
            ? 'Nothing assigned to you today.'
            : `${left} of ${list.length} still to deliver.`}
        </Text>
      </div>
      {list.map((drop) => (
        <DropCard key={`${drop.ref.companyId}-${drop.ref.addressId}-${drop.ref.time}`} drop={drop}>
          {drop.stage === 'out' && (
            <Button fullWidth size="lg" mt="sm" onClick={() => setDelivering(drop)}>
              Mark delivered
            </Button>
          )}
          {drop.stage !== 'out' && drop.stage !== 'delivered' && (
            <Text size="sm" c="dimmed" mt="sm">
              Not out of the kitchen yet.
            </Text>
          )}
        </DropCard>
      ))}
      <Modal
        opened={delivering !== null}
        onClose={() => setDelivering(null)}
        title="Delivered"
        fullScreen
      >
        {delivering && <DeliverDialog drop={delivering} onClose={() => setDelivering(null)} />}
      </Modal>
    </Stack>
  );
}
