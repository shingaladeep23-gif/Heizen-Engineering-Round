'use client';

import { formatMoney, type OptionInput } from '@fernleaf/shared';
import {
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  Stack,
  Switch,
  Table,
  TextInput,
  Title,
  Text,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { api, useAction, useCan, useLists } from '@/lib/api';

type Named = { id: number; name: string };
type OptionRow = Required<Omit<OptionInput, 'allergenIds' | 'dietaryTagIds' | 'sizes'>> & {
  id: number;
  allergens: Named[];
  dietaryTags: Named[];
  sizes: { sizeId: number; extraCharge: number; size: Named }[];
};
type Form = Required<OptionInput> & { sizes: { sizeId: number; extraCharge: number }[] };

const EMPTY: Form = {
  name: '',
  costPrice: 0,
  active: true,
  allergenIds: [],
  dietaryTagIds: [],
  sizes: [],
};

const toSelect = (items: Named[] = []) =>
  items.map((i) => ({ value: String(i.id), label: i.name }));

export default function OptionsPage() {
  const canEdit = useCan('catalogue.manage');
  const lists = useLists();
  const options = useQuery({ queryKey: ['options'], queryFn: () => api<OptionRow[]>('/options') });
  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const form = useForm<Form>({ initialValues: EMPTY });

  const save = useAction(
    (values: Form) =>
      editingId === 'new'
        ? api('/options', { body: values })
        : api(`/options/${editingId}`, { method: 'PUT', body: values }),
    { form, success: 'Option saved', invalidate: ['options'], onSuccess: () => setEditingId(null) },
  );

  const open = (option?: OptionRow) => {
    form.setValues(
      option
        ? {
            ...option,
            allergenIds: option.allergens.map((a) => a.id),
            dietaryTagIds: option.dietaryTags.map((t) => t.id),
            sizes: option.sizes.map(({ sizeId, extraCharge }) => ({ sizeId, extraCharge })),
          }
        : EMPTY,
    );
    form.clearErrors();
    setEditingId(option?.id ?? 'new');
  };

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={2}>Options</Title>
          <Text size="sm" c="dimmed">
            Choices that go with dishes, like rice, proteins and add-ons, each with its own cost,
            allergens and sizes.
          </Text>
        </div>
        {canEdit && <Button onClick={() => open()}>New option</Button>}
      </Group>

      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Cost</Table.Th>
            <Table.Th>Allergens</Table.Th>
            <Table.Th>Dietary</Table.Th>
            <Table.Th>Sizes</Table.Th>
            <Table.Th>Status</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {options.data?.map((option) => (
            <Table.Tr
              key={option.id}
              style={{ cursor: canEdit ? 'pointer' : undefined }}
              onClick={() => canEdit && open(option)}
            >
              <Table.Td>{option.name}</Table.Td>
              <Table.Td>{formatMoney(option.costPrice)}</Table.Td>
              <Table.Td>{option.allergens.map((a) => a.name).join(', ')}</Table.Td>
              <Table.Td>{option.dietaryTags.map((t) => t.name).join(', ')}</Table.Td>
              <Table.Td>
                {option.sizes
                  .map((s) => `${s.size.name} +${formatMoney(s.extraCharge)}`)
                  .join(', ')}
              </Table.Td>
              <Table.Td>
                <Badge color={option.active ? 'green' : 'gray'} variant="light">
                  {option.active ? 'Active' : 'Inactive'}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>

      <Modal
        opened={editingId !== null}
        onClose={() => setEditingId(null)}
        title={editingId === 'new' ? 'New option' : 'Edit option'}
      >
        <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
          <Stack>
            <TextInput label="Name" {...form.getInputProps('name')} />
            <MoneyInput
              label="Cost price"
              value={form.values.costPrice}
              onChange={(paise) => form.setFieldValue('costPrice', paise ?? 0)}
              error={form.errors.costPrice}
            />
            <MultiSelect
              label="Allergens"
              data={toSelect(lists.data?.allergens)}
              value={form.values.allergenIds.map(String)}
              onChange={(v) => form.setFieldValue('allergenIds', v.map(Number))}
            />
            <MultiSelect
              label="Dietary tags"
              data={toSelect(lists.data?.['dietary-tags'])}
              value={form.values.dietaryTagIds.map(String)}
              onChange={(v) => form.setFieldValue('dietaryTagIds', v.map(Number))}
            />
            <MultiSelect
              label="Comes in sizes"
              description="Portions: only needed for options in a group sold in sizes"
              data={toSelect(lists.data?.['portion-sizes'])}
              value={form.values.sizes.map((s) => String(s.sizeId))}
              onChange={(v) =>
                form.setFieldValue(
                  'sizes',
                  v.map(
                    (id) =>
                      form.values.sizes.find((s) => s.sizeId === Number(id)) ?? {
                        sizeId: Number(id),
                        extraCharge: 0,
                      },
                  ),
                )
              }
              error={form.errors.sizes}
            />
            {form.values.sizes.map((s, i) => {
              const name = lists.data?.['portion-sizes'].find((p) => p.id === s.sizeId)?.name;
              return (
                <MoneyInput
                  key={s.sizeId}
                  label={`${name} extra charge`}
                  description="Default tier price; other tiers scale it like the option"
                  value={s.extraCharge}
                  onChange={(paise) => form.setFieldValue(`sizes.${i}.extraCharge`, paise ?? 0)}
                />
              );
            })}
            <Switch label="Active" {...form.getInputProps('active', { type: 'checkbox' })} />
            <Button type="submit" loading={save.isPending}>
              Save option
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
