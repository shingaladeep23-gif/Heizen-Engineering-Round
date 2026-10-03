'use client';

import { formatMoney, ORDER_STATUSES, type OrderPage } from '@fernleaf/shared';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, useAction, useCan } from '@/lib/api';
import { formatClock, formatDay, formatDateTime, STATUS_COLORS, statusLabel } from '@/lib/format';

type Range = [string | null, string | null];

function RunCutoff({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState<string | null>(null);
  const run = useAction(
    () =>
      api<{ cutoffAt: string; confirmed: number; cancelled: number }>('/orders/cutoff/run', {
        body: { date },
      }),
    { invalidate: ['orders'] },
  );
  return (
    <Stack>
      <Text size="sm">
        Runs cut-off processing for one delivery date whose cut-off has passed: drafts are cancelled
        and placed orders are confirmed. Running it twice is harmless.
      </Text>
      <TextInput
        type="date"
        label="Delivery date"
        value={date ?? ''}
        onChange={(e) => setDate(e.currentTarget.value || null)}
      />
      <Button disabled={!date} loading={run.isPending} onClick={() => run.mutate(undefined)}>
        Run cut-off
      </Button>
      {run.data && (
        <Alert color="green">
          Cut-off was {formatDateTime(run.data.cutoffAt)}. {run.data.confirmed} confirmed,{' '}
          {run.data.cancelled} drafts cancelled.
        </Alert>
      )}
      <Button variant="subtle" onClick={onClose}>
        Close
      </Button>
    </Stack>
  );
}

export default function OrdersPage() {
  const router = useRouter();
  const canCreate = useCan('orders.manage');
  const canOverride = useCan('orders.override');
  const [search, setSearch] = useState('');
  const [q] = useDebouncedValue(search, 300);
  const [range, setRange] = useState<Range>([null, null]);
  const [status, setStatus] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [invoiced, setInvoiced] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [cutoffOpen, setCutoffOpen] = useState(false);

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api<{ id: number; name: string }[]>('/companies'),
  });
  const params = new URLSearchParams({ page: String(page) });
  if (q) params.set('q', q);
  if (range[0]) params.set('from', range[0]);
  if (range[1]) params.set('to', range[1]);
  if (status) params.set('status', status);
  if (companyId) params.set('companyId', companyId);
  if (invoiced) params.set('invoiced', invoiced);
  const orders = useQuery({
    queryKey: ['orders', params.toString()],
    queryFn: () => api<OrderPage>(`/orders?${params}`),
    placeholderData: (previous) => previous,
  });

  // Any filter change starts again from page 1.
  const filter =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };

  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Title order={2}>Orders</Title>
          <Text size="sm" c="dimmed">
            Every order, latest delivery date first. Search or filter, then click a row to open it.
          </Text>
        </div>
        <Group>
          {canOverride && (
            <Button variant="light" onClick={() => setCutoffOpen(true)}>
              Run cut-off
            </Button>
          )}
          {canCreate && (
            <Button component={Link} href="/orders/new">
              New order
            </Button>
          )}
        </Group>
      </Group>

      <Group align="flex-end">
        <TextInput
          label="Search"
          placeholder="Order #, employee or company"
          value={search}
          onChange={(e) => filter(setSearch)(e.currentTarget.value)}
          w={240}
        />
        <DatePickerInput
          type="range"
          label="Delivery dates"
          placeholder="Any"
          clearable
          value={range}
          onChange={filter(setRange)}
          valueFormat="D MMM"
          w={200}
        />
        <Select
          label="Status"
          placeholder="Any"
          clearable
          data={ORDER_STATUSES.map((s) => ({ value: s, label: statusLabel(s) }))}
          value={status}
          onChange={filter(setStatus)}
          w={150}
        />
        <Select
          label="Company"
          placeholder="Any"
          clearable
          data={companies.data?.map((c) => ({ value: String(c.id), label: c.name })) ?? []}
          value={companyId}
          onChange={filter(setCompanyId)}
          w={200}
        />
        <Select
          label="Invoiced"
          placeholder="Any"
          clearable
          data={[
            { value: 'yes', label: 'Invoiced' },
            { value: 'no', label: 'Not invoiced' },
          ]}
          value={invoiced}
          onChange={filter(setInvoiced)}
          w={150}
        />
      </Group>

      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>Delivery</Table.Th>
            <Table.Th>Employee</Table.Th>
            <Table.Th>Company</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th ta="right">Total</Table.Th>
            <Table.Th>Invoiced</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {orders.data?.items.map((order) => (
            <Table.Tr
              key={order.id}
              style={{ cursor: 'pointer' }}
              onClick={() => router.push(`/orders/${order.id}`)}
            >
              <Table.Td>#{order.id}</Table.Td>
              <Table.Td>
                {formatDay(order.deliveryDate)}, {formatClock(order.deliveryTime)}
              </Table.Td>
              <Table.Td>{order.employee.name}</Table.Td>
              <Table.Td>{order.company.name}</Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLORS[order.status]} variant="light">
                  {statusLabel(order.status)}
                </Badge>
              </Table.Td>
              <Table.Td ta="right">{formatMoney(order.total)}</Table.Td>
              <Table.Td>{order.invoiced ? 'Yes' : ''}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {orders.data?.items.length === 0 && <Text c="dimmed">No orders match these filters.</Text>}
      {orders.data && orders.data.total > orders.data.pageSize && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {orders.data.total} orders
          </Text>
          <Pagination
            total={Math.ceil(orders.data.total / orders.data.pageSize)}
            value={page}
            onChange={setPage}
          />
        </Group>
      )}

      <Modal opened={cutoffOpen} onClose={() => setCutoffOpen(false)} title="Run cut-off">
        <RunCutoff onClose={() => setCutoffOpen(false)} />
      </Modal>
    </Stack>
  );
}
