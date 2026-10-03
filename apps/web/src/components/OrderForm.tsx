'use client';

import {
  formatMoney,
  type DeliveryInfo,
  type EmployeeMenu,
  type OrderInput,
  type PricedDish,
} from '@fernleaf/shared';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, useAction, useLists } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

type Line = OrderInput['lines'][number];
type Combo = {
  quantity: number;
  optionIds: number[];
  sizes?: { optionId: number; sizeId: number }[]; // for options in groups with portions
};
export type OrderValues = {
  employeeId: number | null;
  deliveryDate: string | null;
  deliveryTime: string;
  addressId: number | null;
  packagingTypeId: number | null;
  // dishName only for lines of an existing order, to name a dish that has
  // since left this employee's menu.
  lines: { dishId: number; dishName?: string; quantity: number; combos: Combo[] }[];
};
type Employee = { id: number; name: string; email: string; company: { name: string } };

type Group = PricedDish['groups'][number];

// The size chosen for an option, or the group's first (the default).
const sizeOf = (group: Group, combo: Combo, optionId: number) =>
  combo.sizes?.find((s) => s.optionId === optionId)?.sizeId ?? group.sizes[0]?.id;

// A preview only: the server prices the order itself.
const unitPrice = (dish: PricedDish, combo: Combo) =>
  dish.price +
  dish.groups.reduce(
    (sum, g) =>
      sum +
      g.options
        .filter((o) => combo.optionIds.includes(o.id))
        .reduce(
          (s, o) =>
            s + o.price + (o.sizes.find((z) => z.id === sizeOf(g, combo, o.id))?.extra ?? 0),
          0,
        ),
    0,
  );

function LineEditor({
  dish,
  line,
  onChange,
  onRemove,
}: {
  dish: PricedDish;
  line: OrderValues['lines'][number];
  onChange: (line: OrderValues['lines'][number]) => void;
  onRemove: () => void;
}) {
  const assigned = line.combos.reduce((sum, c) => sum + c.quantity, 0);
  const lineTotal = line.combos.reduce((sum, c) => sum + unitPrice(dish, c) * c.quantity, 0);
  const setCombo = (i: number, combo: Combo) =>
    onChange({ ...line, combos: line.combos.map((c, j) => (j === i ? combo : c)) });

  // A dish without choices has exactly one combination: all of it.
  const setQuantity = (quantity: number) =>
    onChange(
      dish.groups.length === 0
        ? { ...line, quantity, combos: [{ quantity, optionIds: [] }] }
        : { ...line, quantity },
    );

  return (
    <Card withBorder>
      <Group justify="space-between" mb="xs">
        <div>
          <Text fw={600}>{dish.name}</Text>
          <Text size="xs" c="dimmed">
            {formatMoney(dish.price)} each
            {dish.minOrderQty ? `, minimum ${dish.minOrderQty}` : ''}
          </Text>
        </div>
        <Group>
          <NumberInput
            label="Quantity"
            aria-label={`${dish.name} quantity`}
            w={100}
            min={1}
            allowDecimal={false}
            value={line.quantity}
            onChange={(v) => setQuantity(Number(v) || 0)}
          />
          <ActionIcon
            variant="subtle"
            color="red"
            onClick={onRemove}
            aria-label={`Remove ${dish.name}`}
          >
            ×
          </ActionIcon>
        </Group>
      </Group>
      {dish.warnings.map((w) => (
        <Text key={w} size="xs" c="orange.8">
          ⚠ {w}
        </Text>
      ))}

      {dish.groups.length > 0 && (
        <Stack gap="xs" mt="xs">
          {line.combos.map((combo, i) => (
            <Group key={i} align="flex-end" wrap="wrap">
              <NumberInput
                label="How many"
                aria-label={`${dish.name} combination ${i + 1} quantity`}
                w={90}
                min={1}
                allowDecimal={false}
                value={combo.quantity}
                onChange={(v) => setCombo(i, { ...combo, quantity: Number(v) || 0 })}
              />
              {dish.groups.map((group) => {
                const ids = group.options.map((o) => o.id);
                const picked = combo.optionIds.filter((id) => ids.includes(id));
                const others = combo.optionIds.filter((id) => !ids.includes(id));
                const data = group.options.map((o) => ({
                  value: String(o.id),
                  label: `${o.name} (+${formatMoney(o.price)})${o.warnings.length ? ` ⚠ ${o.warnings.join(', ')}` : ''}`,
                }));
                const label = `${group.name}${group.required ? '' : ' (optional)'}`;
                return group.maxChoices === 1 ? (
                  <Select
                    key={group.id}
                    label={label}
                    aria-label={`${dish.name} combination ${i + 1} ${group.name}`}
                    data={data}
                    clearable={!group.required}
                    value={picked[0] === undefined ? null : String(picked[0])}
                    onChange={(v) =>
                      setCombo(i, { ...combo, optionIds: v ? [...others, Number(v)] : others })
                    }
                    w={220}
                  />
                ) : (
                  <MultiSelect
                    key={group.id}
                    label={`${label}, up to ${group.maxChoices}`}
                    aria-label={`${dish.name} combination ${i + 1} ${group.name}`}
                    data={data}
                    maxValues={group.maxChoices}
                    value={picked.map(String)}
                    onChange={(v) =>
                      setCombo(i, { ...combo, optionIds: [...others, ...v.map(Number)] })
                    }
                    w={260}
                  />
                );
              })}
              {/* Portions: a size for each chosen option in a group sold in sizes. */}
              {dish.groups.flatMap((group) =>
                group.sizes.length === 0
                  ? []
                  : group.options
                      .filter((o) => combo.optionIds.includes(o.id))
                      .map((o) => (
                        <Select
                          key={`size-${group.id}-${o.id}`}
                          label={`${o.name} size`}
                          aria-label={`${dish.name} combination ${i + 1} ${o.name} size`}
                          allowDeselect={false}
                          data={o.sizes.map((z) => ({
                            value: String(z.id),
                            label: z.extra ? `${z.name} (+${formatMoney(z.extra)})` : z.name,
                          }))}
                          value={String(sizeOf(group, combo, o.id))}
                          onChange={(v) =>
                            v &&
                            setCombo(i, {
                              ...combo,
                              sizes: [
                                ...(combo.sizes ?? []).filter((z) => z.optionId !== o.id),
                                { optionId: o.id, sizeId: Number(v) },
                              ],
                            })
                          }
                          w={170}
                        />
                      )),
              )}
              <Text size="sm" mb={8}>
                = {formatMoney(unitPrice(dish, combo) * combo.quantity)}
              </Text>
              {line.combos.length > 1 && (
                <ActionIcon
                  variant="subtle"
                  color="red"
                  mb={6}
                  onClick={() =>
                    onChange({ ...line, combos: line.combos.filter((_, j) => j !== i) })
                  }
                  aria-label="Remove combination"
                >
                  ×
                </ActionIcon>
              )}
            </Group>
          ))}
          <Group justify="space-between">
            <Button
              size="compact-sm"
              variant="light"
              onClick={() =>
                onChange({
                  ...line,
                  combos: [
                    ...line.combos,
                    { quantity: Math.max(line.quantity - assigned, 1), optionIds: [] },
                  ],
                })
              }
            >
              Add combination
            </Button>
            <Badge
              color={assigned === line.quantity ? 'green' : 'orange'}
              variant="light"
              tt="none"
            >
              {line.combos.map((c) => c.quantity).join(' + ')} of {line.quantity} assigned
            </Badge>
          </Group>
        </Stack>
      )}
      <Text ta="right" fw={600} mt="xs">
        Line total {formatMoney(lineTotal)}
      </Text>
    </Card>
  );
}

export function OrderForm({ orderId, initial }: { orderId?: number; initial?: OrderValues }) {
  const router = useRouter();
  const lists = useLists();
  const [values, setValues] = useState<OrderValues>(
    initial ?? {
      employeeId: null,
      deliveryDate: null,
      deliveryTime: '',
      addressId: null,
      packagingTypeId: null,
      lines: [],
    },
  );
  const set = (changes: Partial<OrderValues>) => setValues((v) => ({ ...v, ...changes }));
  const { employeeId, deliveryDate } = values;

  const employees = useQuery({
    queryKey: ['employees'],
    queryFn: () => api<Employee[]>('/employees'),
  });
  const info = useQuery({
    queryKey: ['delivery-info', employeeId, deliveryDate],
    queryFn: () =>
      api<DeliveryInfo>(`/orders/delivery-info?employeeId=${employeeId}&date=${deliveryDate}`),
    enabled: !!employeeId && !!deliveryDate,
  });
  const menu = useQuery({
    queryKey: ['order-menu', employeeId],
    queryFn: () => api<EmployeeMenu>(`/menu/preview?employeeId=${employeeId}&allSecret=true`),
    enabled: !!employeeId,
  });

  // Nothing chosen yet means the company default. The server applies the
  // same defaults when a field is sent empty.
  const defaults = info.data?.defaults;
  const shownTime = values.deliveryTime || defaults?.deliveryTime || '';
  const shownAddress = values.addressId ?? defaults?.addressId ?? null;
  const shownPackaging = values.packagingTypeId ?? defaults?.packagingTypeId ?? null;

  const dishes = new Map(
    (menu.data?.categories ?? []).flatMap((c) => c.dishes).map((d) => [d.id, d]),
  );
  const total = values.lines.reduce((sum, line) => {
    const dish = dishes.get(line.dishId);
    return sum + (dish ? line.combos.reduce((s, c) => s + unitPrice(dish, c) * c.quantity, 0) : 0);
  }, 0);

  const save = useAction(
    (place: boolean) => {
      const body: OrderInput = {
        employeeId: values.employeeId ?? 0,
        deliveryDate: values.deliveryDate ?? '',
        deliveryTime: values.deliveryTime || null,
        addressId: values.addressId,
        packagingTypeId: values.packagingTypeId,
        lines: values.lines as Line[],
        place,
      };
      return orderId
        ? api<{ id: number }>(`/orders/${orderId}`, { method: 'PUT', body })
        : api<{ id: number }>('/orders', { body });
    },
    {
      success: 'Order saved',
      invalidate: ['orders'],
      onSuccess: (saved) => router.push(`/orders/${saved.id}`),
    },
  );

  const allowed = info.data?.allowed;
  const blocked = !!info.data && (info.data.problems.length > 0 || !info.data.cutoffAt);

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Select
          label="Employee"
          placeholder="Who is this for?"
          searchable
          disabled={!!orderId}
          data={Object.entries(Object.groupBy(employees.data ?? [], (e) => e.company.name)).map(
            ([group, list]) => ({
              group,
              items: (list ?? []).map((e) => ({
                value: String(e.id),
                label: `${e.name} (${e.email})`,
              })),
            }),
          )}
          value={employeeId ? String(employeeId) : null}
          onChange={(v) =>
            set({
              employeeId: v ? Number(v) : null,
              lines: [],
              deliveryTime: '',
              addressId: null,
              packagingTypeId: null,
            })
          }
        />
        <TextInput
          type="date"
          label="Delivery date"
          value={deliveryDate ?? ''}
          onChange={(e) => set({ deliveryDate: e.currentTarget.value || null })}
        />
      </SimpleGrid>

      {info.data?.problems.map((p) => (
        <Alert key={p} color="red">
          {p}
        </Alert>
      ))}
      {info.data?.cutoffAt && info.data.problems.length === 0 && (
        <Alert color={info.data.cutoffPassed ? 'orange' : 'blue'}>
          {info.data.cutoffPassed
            ? `The cut-off was ${formatDateTime(info.data.cutoffAt)}. As an admin you can still place this order, and it will be confirmed straight away.`
            : `Cut-off: ${formatDateTime(info.data.cutoffAt)}. Until then it can be edited or cancelled.`}
        </Alert>
      )}

      {info.data && (
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TimeInput
            label="Delivery time"
            description={
              allowed?.time ? undefined : 'Company default; this employee can’t change it'
            }
            disabled={!allowed?.time}
            value={shownTime}
            onChange={(e) => set({ deliveryTime: e.currentTarget.value })}
          />
          <Select
            label="Address"
            description={
              allowed?.address ? undefined : 'Company default; this employee can’t change it'
            }
            disabled={!allowed?.address}
            data={info.data.addresses.map((a) => ({ value: String(a.id), label: a.label }))}
            value={shownAddress ? String(shownAddress) : null}
            onChange={(v) => set({ addressId: v ? Number(v) : null })}
          />
          <Select
            label="Packaging"
            description={
              allowed?.packaging ? undefined : 'Company default; this employee can’t change it'
            }
            disabled={!allowed?.packaging}
            data={(lists.data?.['packaging-types'] ?? []).map((p) => ({
              value: String(p.id),
              label: p.name,
            }))}
            value={shownPackaging ? String(shownPackaging) : null}
            onChange={(v) => set({ packagingTypeId: v ? Number(v) : null })}
          />
        </SimpleGrid>
      )}

      {menu.data && (
        <Card withBorder>
          <Text fw={600}>
            {menu.data.employee.name}&apos;s menu{' '}
            <Text span c="dimmed" size="sm">
              ({menu.data.tierName} prices)
            </Text>
          </Text>
          <Table>
            <Table.Tbody>
              {menu.data.categories.flatMap((category) =>
                category.dishes.map((dish) => (
                  <Table.Tr key={dish.id}>
                    <Table.Td c="dimmed" w={160}>
                      {category.name}{' '}
                      {category.secret && (
                        <Badge size="xs" color="grape">
                          Secret
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {dish.name}
                      {dish.warnings.length > 0 && (
                        <Text span c="orange.8" size="xs">
                          {' '}
                          ⚠ {dish.warnings.join(', ')}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>{formatMoney(dish.price)}</Table.Td>
                    <Table.Td w={80}>
                      <Button
                        size="compact-xs"
                        variant="light"
                        aria-label={`Add ${dish.name}`}
                        disabled={values.lines.some((l) => l.dishId === dish.id)}
                        onClick={() => {
                          const quantity = dish.minOrderQty ?? 1;
                          set({
                            lines: [
                              ...values.lines,
                              { dishId: dish.id, quantity, combos: [{ quantity, optionIds: [] }] },
                            ],
                          });
                        }}
                      >
                        Add
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                )),
              )}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      {values.lines.length > 0 && <Title order={4}>This order</Title>}
      {values.lines.map((line, i) => {
        const dish = dishes.get(line.dishId);
        const remove = () => set({ lines: values.lines.filter((_, j) => j !== i) });
        if (!dish) {
          // Hidden, deactivated or unpriced since the order was saved: say so,
          // rather than hiding a line the server will refuse.
          if (!menu.data) return null;
          return (
            <Alert key={line.dishId} color="red" title="No longer on this employee's menu">
              <Group justify="space-between">
                <Text size="sm">
                  {line.quantity} × {line.dishName ?? `dish #${line.dishId}`} can&apos;t be ordered
                  any more. Remove it to save the order.
                </Text>
                <Button size="compact-sm" color="red" variant="light" onClick={remove}>
                  Remove
                </Button>
              </Group>
            </Alert>
          );
        }
        return (
          <LineEditor
            key={line.dishId}
            dish={dish}
            line={line}
            onChange={(next) => set({ lines: values.lines.map((l, j) => (j === i ? next : l)) })}
            onRemove={remove}
          />
        );
      })}

      <Group justify="space-between">
        <Title order={3}>Total {formatMoney(total)}</Title>
        <Group>
          {!info.data?.cutoffPassed && (
            <Button
              variant="default"
              loading={save.isPending}
              disabled={blocked}
              onClick={() => save.mutate(false)}
            >
              Save as draft
            </Button>
          )}
          <Button loading={save.isPending} disabled={blocked} onClick={() => save.mutate(true)}>
            Place order
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}

// An existing order, in the shape the form (and the API) expects.
export const valuesFromOrder = (order: import('@fernleaf/shared').OrderDetail): OrderValues => ({
  employeeId: order.employee.id,
  deliveryDate: order.deliveryDate,
  deliveryTime: order.deliveryTime,
  addressId: order.address.id,
  packagingTypeId: order.packagingType?.id ?? null,
  lines: order.lines.map((line) => ({
    dishId: line.dishId,
    dishName: line.dishName,
    quantity: line.quantity,
    combos: line.combos.map((c) => ({
      quantity: c.quantity,
      optionIds: c.choices.map((ch) => ch.optionId),
      sizes: c.choices.flatMap((ch) =>
        ch.size ? [{ optionId: ch.optionId, sizeId: ch.size.id }] : [],
      ),
    })),
  })),
});
