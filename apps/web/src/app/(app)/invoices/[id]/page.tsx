'use client';

import { formatMoney, type InvoiceDetail } from '@fernleaf/shared';
import { Badge, Card, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Waiting } from '@/components/Waiting';
import { api } from '@/lib/api';
import { formatDateTime, formatDay, statusLabel } from '@/lib/format';

export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const invoice = useQuery({
    queryKey: ['billing', 'invoice', id],
    queryFn: () => api<InvoiceDetail>(`/billing/invoices/${id}`),
  });
  if (!invoice.data) return <Waiting error={invoice.error} />;
  const inv = invoice.data;
  const ordersTotal = inv.orders.reduce((s, o) => s + o.total, 0);

  return (
    <Stack maw={800}>
      <Group justify="space-between">
        <Title order={2}>Invoice #{inv.id}</Title>
        <Badge size="lg" color={inv.paidAt ? 'green' : 'orange'} variant="light">
          {inv.paidAt ? `Paid ${formatDateTime(inv.paidAt)}` : 'Unpaid'}
        </Badge>
      </Group>
      <Card withBorder>
        <Text fw={600}>{inv.company.billingName}</Text>
        <Text size="sm">
          {inv.company.billingEmail}
          {inv.company.billingPhone && `, ${inv.company.billingPhone}`}
        </Text>
        <Text size="sm" c="dimmed">
          Created {formatDateTime(inv.createdAt)}. An internal record: no tax, no fees.
        </Text>
      </Card>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Order</Table.Th>
            <Table.Th>Delivered for</Table.Th>
            <Table.Th>Employee</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th ta="right">Amount</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {inv.orders.map((o) => (
            <Table.Tr key={o.id}>
              <Table.Td>
                <Link href={`/orders/${o.id}`}>#{o.id}</Link>
              </Table.Td>
              <Table.Td>{formatDay(o.deliveryDate)}</Table.Td>
              <Table.Td>{o.employee}</Table.Td>
              <Table.Td>{statusLabel(o.status)}</Table.Td>
              <Table.Td ta="right">{formatMoney(o.total)}</Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr>
            <Table.Td colSpan={4} ta="right">
              Orders
            </Table.Td>
            <Table.Td ta="right">{formatMoney(ordersTotal)}</Table.Td>
          </Table.Tr>
          {inv.credits.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td colSpan={4} ta="right">
                Credit on #{c.orderId}: {c.reason}
              </Table.Td>
              <Table.Td ta="right">{formatMoney(c.amount)}</Table.Td>
            </Table.Tr>
          ))}
          <Table.Tr>
            <Table.Td colSpan={4} ta="right" fw={700}>
              Total
            </Table.Td>
            <Table.Td ta="right" fw={700}>
              {formatMoney(inv.total)}
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed">
        The total was fixed when the invoice was created. Later changes to these orders appear as
        credits on the company&apos;s next invoice.
      </Text>
    </Stack>
  );
}
