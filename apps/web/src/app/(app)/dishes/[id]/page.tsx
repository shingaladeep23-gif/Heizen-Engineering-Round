'use client';

import type { DishInput } from '@fernleaf/shared';
import {
  ActionIcon,
  Button,
  Card,
  Checkbox,
  Group,
  Image,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { Waiting } from '@/components/Waiting';
import { api, useAction, useCan, useLists } from '@/lib/api';

type Form = Required<Omit<DishInput, 'optionGroups'>> & {
  optionGroups: { name: string; required: boolean; maxChoices: number; optionIds: number[] }[];
};

const EMPTY: Form = {
  sku: '',
  name: '',
  description: '',
  imageUrl: null,
  temperature: 'HOT',
  costPrice: 0,
  minOrderQty: null,
  stationId: null,
  active: true,
  allergenIds: [],
  dietaryTagIds: [],
  optionGroups: [],
};

const toSelect = (items: { id: number; name: string }[] = []) =>
  items.map((item) => ({ value: String(item.id), label: item.name }));
const toIds = (values: string[]) => values.map(Number);
const toValues = (ids: number[]) => ids.map(String);

export default function DishPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const router = useRouter();
  const canEdit = useCan('catalogue.manage');
  const lists = useLists();
  const options = useQuery({
    queryKey: ['options'],
    queryFn: () => api<{ id: number; name: string; active: boolean }[]>('/options'),
  });
  const dish = useQuery({
    queryKey: ['dishes', id],
    queryFn: () => api<Form>(`/dishes/${id}`),
    enabled: !isNew,
  });
  const form = useForm<Form>({ initialValues: EMPTY });

  // Load the saved dish into the form once it arrives.
  useEffect(() => {
    if (dish.data) form.setValues({ ...EMPTY, ...dish.data });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dish.data]);

  const save = useAction(
    (values: Form) =>
      api<{ id: number }>(isNew ? '/dishes' : `/dishes/${id}`, {
        method: isNew ? 'POST' : 'PUT',
        body: { ...values, imageUrl: values.imageUrl || null },
      }),
    {
      form,
      success: 'Dish saved',
      invalidate: ['dishes'],
      onSuccess: (saved) => isNew && router.replace(`/dishes/${saved.id}`),
    },
  );

  if (!isNew && !dish.data) return <Waiting error={dish.error} />;

  const groups = form.values.optionGroups;
  const optionChoices = toSelect(options.data?.filter((o) => o.active));
  const moveGroup = (from: number, to: number) =>
    form.reorderListItem('optionGroups', { from, to });

  return (
    <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }}>
        <Group justify="space-between" mb="md">
          <Title order={2}>{isNew ? 'New dish' : form.values.name}</Title>
          {canEdit && (
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          )}
        </Group>

        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <TextInput label="Name" {...form.getInputProps('name')} />
            <TextInput label="SKU" {...form.getInputProps('sku')} />
          </SimpleGrid>
          <Textarea
            label="Description"
            autosize
            minRows={2}
            {...form.getInputProps('description')}
          />
          <TextInput
            label="Image link"
            placeholder="https://..."
            {...form.getInputProps('imageUrl')}
            value={form.values.imageUrl ?? ''}
          />
          {form.values.imageUrl && (
            <Image
              src={form.values.imageUrl}
              h={120}
              w={200}
              radius="sm"
              alt="Dish photo preview"
            />
          )}
          <SimpleGrid cols={{ base: 1, sm: 4 }}>
            <MoneyInput
              label="Cost price"
              value={form.values.costPrice}
              onChange={(paise) => form.setFieldValue('costPrice', paise ?? 0)}
              error={form.errors.costPrice}
            />
            <Select
              label="Kitchen station"
              placeholder="Unassigned"
              clearable
              data={toSelect(lists.data?.stations)}
              value={form.values.stationId === null ? null : String(form.values.stationId)}
              onChange={(v) => form.setFieldValue('stationId', v ? Number(v) : null)}
            />
            <NumberInput
              label="Minimum order qty"
              placeholder="None"
              min={1}
              allowDecimal={false}
              value={form.values.minOrderQty ?? ''}
              onChange={(v) => form.setFieldValue('minOrderQty', v === '' ? null : Number(v))}
              error={form.errors.minOrderQty}
            />
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Temperature
              </Text>
              <SegmentedControl
                data={[
                  { value: 'HOT', label: 'Hot' },
                  { value: 'COLD', label: 'Cold' },
                ]}
                {...form.getInputProps('temperature')}
              />
            </Stack>
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <MultiSelect
              label="Allergens"
              data={toSelect(lists.data?.allergens)}
              value={toValues(form.values.allergenIds)}
              onChange={(v) => form.setFieldValue('allergenIds', toIds(v))}
            />
            <MultiSelect
              label="Dietary tags"
              data={toSelect(lists.data?.['dietary-tags'])}
              value={toValues(form.values.dietaryTagIds)}
              onChange={(v) => form.setFieldValue('dietaryTagIds', toIds(v))}
            />
          </SimpleGrid>
          <Switch
            label="Active (deactivated dishes stay on old orders but can't be ordered)"
            {...form.getInputProps('active', { type: 'checkbox' })}
          />

          <Group justify="space-between" mt="md">
            <Title order={4}>Option groups</Title>
            {canEdit && (
              <Button
                variant="light"
                onClick={() =>
                  form.insertListItem('optionGroups', {
                    name: '',
                    required: true,
                    maxChoices: 1,
                    optionIds: [],
                  })
                }
              >
                Add group
              </Button>
            )}
          </Group>
          {groups.length === 0 && (
            <Text c="dimmed" size="sm">
              No choices for this dish.
            </Text>
          )}
          {groups.map((group, i) => (
            <Card key={i} withBorder>
              <Group align="flex-end">
                <TextInput
                  label="Group name"
                  placeholder="Choose your protein"
                  style={{ flex: 1 }}
                  {...form.getInputProps(`optionGroups.${i}.name`)}
                />
                <NumberInput
                  label="Max choices"
                  w={110}
                  min={1}
                  allowDecimal={false}
                  {...form.getInputProps(`optionGroups.${i}.maxChoices`)}
                />
                <Checkbox
                  label="Required"
                  mb={8}
                  {...form.getInputProps(`optionGroups.${i}.required`, { type: 'checkbox' })}
                />
                {canEdit && (
                  <Group gap={4} mb={4}>
                    <ActionIcon
                      variant="subtle"
                      disabled={i === 0}
                      onClick={() => moveGroup(i, i - 1)}
                      aria-label="Move up"
                    >
                      ↑
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      disabled={i === groups.length - 1}
                      onClick={() => moveGroup(i, i + 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </ActionIcon>
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={() => form.removeListItem('optionGroups', i)}
                      aria-label="Remove group"
                    >
                      ×
                    </ActionIcon>
                  </Group>
                )}
              </Group>
              <MultiSelect
                mt="sm"
                label="Options, in the order they're shown"
                searchable
                data={optionChoices}
                value={toValues(group.optionIds)}
                onChange={(v) => form.setFieldValue(`optionGroups.${i}.optionIds`, toIds(v))}
                error={form.errors[`optionGroups.${i}.optionIds`]}
              />
            </Card>
          ))}
        </Stack>
      </fieldset>
    </form>
  );
}
