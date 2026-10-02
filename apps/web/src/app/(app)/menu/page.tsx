'use client';

import {
  ActionIcon,
  Button,
  Card,
  Group,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api, useAction, useCan } from '@/lib/api';

type Item = {
  id: number;
  dishId: number;
  active: boolean;
  dish: { name: string; active: boolean };
};
type Category = { id: number; name: string; active: boolean; secret: boolean; items: Item[] };

// Swap two neighbours and send the new order of ids.
const moved = (ids: number[], from: number, to: number) => {
  const copy = [...ids];
  [copy[from], copy[to]] = [copy[to], copy[from]];
  return copy;
};

function UpDown({
  index,
  count,
  onMove,
}: {
  index: number;
  count: number;
  onMove: (to: number) => void;
}) {
  return (
    <Group gap={2} wrap="nowrap">
      <ActionIcon
        variant="subtle"
        size="sm"
        disabled={index === 0}
        onClick={() => onMove(index - 1)}
        aria-label="Move up"
      >
        ↑
      </ActionIcon>
      <ActionIcon
        variant="subtle"
        size="sm"
        disabled={index === count - 1}
        onClick={() => onMove(index + 1)}
        aria-label="Move down"
      >
        ↓
      </ActionIcon>
    </Group>
  );
}

function CategoryCard({
  category,
  index,
  all,
}: {
  category: Category;
  index: number;
  all: Category[];
}) {
  const canEdit = useCan('catalogue.manage');
  const dishes = useQuery({
    queryKey: ['dishes'],
    queryFn: () => api<{ id: number; name: string; active: boolean }[]>('/dishes'),
  });
  const [dishId, setDishId] = useState<string | null>(null);
  const invalidate = ['menu'];

  const update = useAction(
    (changes: Partial<Category>) =>
      api(`/menu/categories/${category.id}`, { method: 'PUT', body: { ...category, ...changes } }),
    { invalidate },
  );
  const reorder = useAction(
    (ids: number[]) => api('/menu/categories/order', { method: 'PUT', body: { ids } }),
    {
      invalidate,
    },
  );
  const addItem = useAction(
    () => api(`/menu/categories/${category.id}/items`, { body: { dishId: Number(dishId) } }),
    {
      invalidate,
      onSuccess: () => setDishId(null),
    },
  );
  const toggleItem = useAction(
    (item: Item) =>
      api(`/menu/items/${item.id}`, { method: 'PUT', body: { active: !item.active } }),
    {
      invalidate,
    },
  );
  const removeItem = useAction((id: number) => api(`/menu/items/${id}`, { method: 'DELETE' }), {
    invalidate,
  });
  const reorderItems = useAction(
    (ids: number[]) =>
      api(`/menu/categories/${category.id}/items/order`, { method: 'PUT', body: { ids } }),
    { invalidate },
  );

  const itemIds = category.items.map((i) => i.id);
  const notYetIn = (dishes.data ?? []).filter(
    (d) => d.active && !category.items.some((i) => i.dishId === d.id),
  );

  return (
    <Card withBorder style={{ opacity: category.active ? 1 : 0.6 }}>
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          {canEdit && (
            <UpDown
              index={index}
              count={all.length}
              onMove={(to) =>
                reorder.mutate(
                  moved(
                    all.map((c) => c.id),
                    index,
                    to,
                  ),
                )
              }
            />
          )}
          <Title order={4}>{category.name}</Title>
        </Group>
        <Group>
          <Switch
            label="Active"
            disabled={!canEdit}
            checked={category.active}
            onChange={(e) => update.mutate({ active: e.currentTarget.checked })}
          />
          <Switch
            label="Secret"
            disabled={!canEdit}
            checked={category.secret}
            onChange={(e) => update.mutate({ secret: e.currentTarget.checked })}
          />
        </Group>
      </Group>

      <Table>
        <Table.Tbody>
          {category.items.map((item, i) => (
            <Table.Tr key={item.id} style={{ opacity: item.active && item.dish.active ? 1 : 0.5 }}>
              <Table.Td w={60}>
                {canEdit && (
                  <UpDown
                    index={i}
                    count={itemIds.length}
                    onMove={(to) => reorderItems.mutate(moved(itemIds, i, to))}
                  />
                )}
              </Table.Td>
              <Table.Td>
                {item.dish.name}
                {!item.dish.active && ' (dish deactivated)'}
              </Table.Td>
              <Table.Td w={120}>
                <Switch
                  size="xs"
                  label="Shown"
                  disabled={!canEdit}
                  checked={item.active}
                  onChange={() => toggleItem.mutate(item)}
                />
              </Table.Td>
              <Table.Td w={90}>
                {canEdit && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => removeItem.mutate(item.id)}
                  >
                    Remove
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      {canEdit && (
        <Group mt="sm" gap="xs">
          <Select
            placeholder="Add a dish to this category"
            aria-label={`Add a dish to ${category.name}`}
            searchable
            data={notYetIn.map((d) => ({ value: String(d.id), label: d.name }))}
            value={dishId}
            onChange={setDishId}
            style={{ flex: 1 }}
          />
          <Button variant="light" disabled={!dishId} onClick={() => addItem.mutate(undefined)}>
            Add
          </Button>
        </Group>
      )}
    </Card>
  );
}

export default function MenuPage() {
  const canEdit = useCan('catalogue.manage');
  const categories = useQuery({
    queryKey: ['menu'],
    queryFn: () => api<Category[]>('/menu/categories'),
  });
  const [name, setName] = useState('');
  const create = useAction(() => api('/menu/categories', { body: { name } }), {
    invalidate: ['menu'],
    onSuccess: () => setName(''),
  });

  return (
    <Stack>
      <Title order={2}>Menu</Title>
      <Text size="sm" c="dimmed">
        Hiding a category or dish from a specific company is done on that company. Secret categories
        aren&apos;t listed on the menu but staff can still open them.
      </Text>
      {categories.data?.map((category, index) => (
        <CategoryCard key={category.id} category={category} index={index} all={categories.data} />
      ))}
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <Group gap="xs">
            <TextInput
              placeholder="New category name"
              aria-label="New category name"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              style={{ flex: 1 }}
            />
            <Button type="submit" loading={create.isPending}>
              Add category
            </Button>
          </Group>
        </form>
      )}
    </Stack>
  );
}
