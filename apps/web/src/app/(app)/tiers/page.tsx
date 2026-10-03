'use client';

import {
  formatMoney,
  type GridRow,
  type Tier,
  type TierGrid,
  type TierInput,
} from '@fernleaf/shared';
import {
  Badge,
  Button,
  Card,
  CloseButton,
  Group,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { api, useAction, useCan } from '@/lib/api';

// Plain-English version of a tier's rule, e.g. "Standard − 10%".
function ruleText(tier: Tier, tiers: Tier[]) {
  if (!tier.base || !tier.factor) return 'Prices typed in';
  if (tier.base === 'COST') return `Cost × ${tier.factor}`;
  const base = tiers.find((t) => t.id === tier.baseTierId)?.name ?? 'base tier';
  const percent = Math.round((tier.factor - 1) * 1000) / 10;
  return `${base} ${percent >= 0 ? '+' : '−'} ${Math.abs(percent)}%`;
}

function PriceCell({ tier, kind, row }: { tier: Tier; kind: 'dish' | 'option'; row: GridRow }) {
  const canEdit = useCan('catalogue.manage');
  const [draft, setDraft] = useState<number | null>(row.typed);
  const save = useAction(
    (price: number | null) =>
      api(`/tiers/${tier.id}/prices`, { method: 'PUT', body: { kind, id: row.id, price } }),
    { invalidate: ['tiers', 'grid'], onSuccess: () => undefined },
  );
  const commit = (price: number | null) => price !== row.typed && save.mutate(price);
  const derived = tier.base !== null;

  return (
    <Group gap={4} wrap="nowrap">
      <MoneyInput
        size="xs"
        w={120}
        aria-label={`${row.name} price`}
        placeholder={derived ? 'Formula' : 'No price'}
        disabled={!canEdit}
        value={draft}
        onChange={setDraft}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => e.key === 'Enter' && commit(draft)}
      />
      {canEdit && row.typed !== null && (
        <CloseButton
          size="sm"
          aria-label={`Clear ${row.name} price`}
          onClick={() => {
            setDraft(null);
            commit(null);
          }}
        />
      )}
    </Group>
  );
}

function GridTable({ tier, kind, rows }: { tier: Tier; kind: 'dish' | 'option'; rows: GridRow[] }) {
  return (
    <Table>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{kind === 'dish' ? 'Dish' : 'Option'}</Table.Th>
          <Table.Th>Cost</Table.Th>
          <Table.Th>{tier.base ? 'Override' : 'Price'}</Table.Th>
          <Table.Th>Employees pay</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr
            key={`${tier.id}-${row.id}-${row.typed}`}
            style={{ opacity: row.active ? 1 : 0.5 }}
          >
            <Table.Td>
              {row.name}
              {!row.active && ' (inactive)'}
            </Table.Td>
            <Table.Td>{formatMoney(row.cost)}</Table.Td>
            <Table.Td>
              <PriceCell tier={tier} kind={kind} row={row} />
            </Table.Td>
            <Table.Td>
              {row.price === null ? (
                <Badge color="red" variant="light">
                  Missing: hidden from menus
                </Badge>
              ) : (
                <Text size="sm">
                  {formatMoney(row.price)}{' '}
                  {tier.base && row.typed === null && (
                    <Text span c="dimmed" size="xs">
                      (formula)
                    </Text>
                  )}
                </Text>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

const EMPTY_TIER: Required<TierInput> = { name: '', base: null, baseTierId: null, factor: null };

export default function TiersPage() {
  const canEdit = useCan('catalogue.manage');
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => api<Tier[]>('/tiers') });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = selectedId ?? tiers.data?.[0]?.id ?? null;
  const grid = useQuery({
    queryKey: ['grid', selected],
    queryFn: () => api<TierGrid>(`/tiers/${selected}/grid`),
    enabled: selected !== null,
  });
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const form = useForm<Required<TierInput>>({ initialValues: EMPTY_TIER });

  const saveTier = useAction(
    (values: Required<TierInput>) =>
      editing === 'new'
        ? api('/tiers', { body: values })
        : api(`/tiers/${editing}`, { method: 'PUT', body: values }),
    {
      form,
      success: 'Tier saved',
      invalidate: ['tiers', 'grid'],
      onSuccess: () => setEditing(null),
    },
  );
  const makeDefault = useAction((id: number) => api(`/tiers/${id}/default`, { method: 'PUT' }), {
    success: 'Default tier changed',
    invalidate: ['tiers'],
  });

  const openTier = (tier?: Tier) => {
    form.setValues(
      tier
        ? { name: tier.name, base: tier.base, baseTierId: tier.baseTierId, factor: tier.factor }
        : EMPTY_TIER,
    );
    form.clearErrors();
    setEditing(tier?.id ?? 'new');
  };

  const all = tiers.data ?? [];
  const filter = (rows: GridRow[] = []) =>
    onlyMissing ? rows.filter((r) => r.price === null && r.active) : rows;

  return (
    <>
      <Group justify="space-between" mb="md">
        <div>
          <Title order={2}>Price tiers</Title>
          <Text size="sm" c="dimmed">
            Each company pays its tier’s prices (or the default tier’s). Click a tier to see and
            edit every price; red means that dish can’t be ordered on it.
          </Text>
        </div>
        {canEdit && <Button onClick={() => openTier()}>New tier</Button>}
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="lg">
        {all.map((tier) => (
          <Card
            key={tier.id}
            withBorder
            style={{
              cursor: 'pointer',
              borderColor: tier.id === selected ? 'var(--mantine-color-blue-5)' : undefined,
            }}
            onClick={() => setSelectedId(tier.id)}
          >
            <Group justify="space-between">
              <Text fw={600}>{tier.name}</Text>
              {tier.isDefault && <Badge>Default</Badge>}
            </Group>
            <Text size="sm" c="dimmed">
              {ruleText(tier, all)}
            </Text>
            <Badge mt="xs" variant="light" color={tier.missingDishes ? 'red' : 'green'}>
              {tier.missingDishes
                ? `${tier.missingDishes} dishes without a price`
                : 'Every dish priced'}
            </Badge>
          </Card>
        ))}
      </SimpleGrid>

      {grid.data && (
        <Stack>
          <Group justify="space-between">
            <Title order={3}>{grid.data.tier.name}</Title>
            <Group>
              <Switch
                label="Only show missing"
                checked={onlyMissing}
                onChange={(e) => setOnlyMissing(e.currentTarget.checked)}
              />
              {canEdit && (
                <>
                  <Button variant="light" onClick={() => openTier(grid.data.tier)}>
                    Edit rule
                  </Button>
                  {!grid.data.tier.isDefault && (
                    <Button variant="light" onClick={() => makeDefault.mutate(grid.data.tier.id)}>
                      Make default
                    </Button>
                  )}
                </>
              )}
            </Group>
          </Group>
          <Text size="sm" c="dimmed">
            Price changes only affect new orders. Orders already placed keep the price they were
            placed at.
          </Text>
          <GridTable tier={grid.data.tier} kind="dish" rows={filter(grid.data.dishes)} />
          <GridTable tier={grid.data.tier} kind="option" rows={filter(grid.data.options)} />
        </Stack>
      )}

      <Modal
        opened={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New tier' : 'Edit tier'}
      >
        <form onSubmit={form.onSubmit((values) => saveTier.mutate(values))}>
          <Stack>
            <TextInput label="Name" {...form.getInputProps('name')} />
            <Select
              label="How prices are set"
              allowDeselect={false}
              data={[
                { value: 'TYPED', label: 'Typed in by hand' },
                { value: 'COST', label: 'Cost × a factor' },
                { value: 'TIER', label: 'Another tier × a factor' },
              ]}
              value={form.values.base ?? 'TYPED'}
              onChange={(v) =>
                form.setFieldValue('base', v === 'TYPED' ? null : (v as 'COST' | 'TIER'))
              }
              error={form.errors.base}
            />
            {form.values.base === 'TIER' && (
              <Select
                label="Derived from"
                data={all
                  .filter((t) => t.base === null && t.id !== editing)
                  .map((t) => ({ value: String(t.id), label: t.name }))}
                value={form.values.baseTierId === null ? null : String(form.values.baseTierId)}
                onChange={(v) => form.setFieldValue('baseTierId', v ? Number(v) : null)}
                error={form.errors.baseTierId}
              />
            )}
            {form.values.base !== null && (
              <NumberInput
                label="Factor"
                description="2.4 = cost × 2.4. 1.15 = +15%. 0.9 = −10%. Results round up to the next 5 paise."
                decimalScale={4}
                min={0}
                value={form.values.factor ?? ''}
                onChange={(v) => form.setFieldValue('factor', v === '' ? null : Number(v))}
                error={form.errors.factor}
              />
            )}
            <Button type="submit" loading={saveTier.isPending}>
              Save tier
            </Button>
          </Stack>
        </form>
      </Modal>
    </>
  );
}
