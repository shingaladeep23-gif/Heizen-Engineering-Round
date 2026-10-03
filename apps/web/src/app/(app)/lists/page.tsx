'use client';

import { LIST_KINDS, type ListKind } from '@fernleaf/shared';
import {
  Badge,
  Button,
  Card,
  CloseButton,
  Group,
  SimpleGrid,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { api, useAction, useCan, useLists } from '@/lib/api';

const TITLES: Record<ListKind, string> = {
  allergens: 'Allergens',
  'dietary-tags': 'Dietary tags',
  stations: 'Kitchen stations',
  'packaging-types': 'Packaging types',
  'portion-sizes': 'Portion sizes',
};

function ListCard({ kind }: { kind: ListKind }) {
  const canEdit = useCan('catalogue.manage');
  const lists = useLists();
  const [name, setName] = useState('');
  const add = useAction(() => api(`/lists/${kind}`, { body: { name } }), {
    invalidate: ['lists'],
    onSuccess: () => setName(''),
  });
  const remove = useAction((id: number) => api(`/lists/${kind}/${id}`, { method: 'DELETE' }), {
    invalidate: ['lists'],
  });

  return (
    <Card withBorder>
      <Text fw={600} mb="sm">
        {TITLES[kind]}
      </Text>
      <Group gap="xs" mb="sm">
        {lists.data?.[kind].map((item) => (
          <Badge
            key={item.id}
            variant="light"
            size="lg"
            tt="none"
            rightSection={
              canEdit && (
                <CloseButton
                  size="xs"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => remove.mutate(item.id)}
                />
              )
            }
          >
            {item.name}
          </Badge>
        ))}
      </Group>
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(undefined);
          }}
        >
          <Group gap="xs">
            <TextInput
              placeholder={`Add to ${TITLES[kind].toLowerCase()}`}
              aria-label={`New ${TITLES[kind]}`}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button type="submit" variant="light" loading={add.isPending}>
              Add
            </Button>
          </Group>
        </form>
      )}
    </Card>
  );
}

export default function ListsPage() {
  return (
    <>
      <Title order={2} mb="md">
        Reference lists
      </Title>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {LIST_KINDS.map((kind) => (
          <ListCard key={kind} kind={kind} />
        ))}
      </SimpleGrid>
    </>
  );
}
