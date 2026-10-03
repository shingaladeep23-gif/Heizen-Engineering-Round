'use client';

import { formatMoney, type CompanyBilling } from '@fernleaf/shared';
import { Badge, Button, Card, Checkbox, Group, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Waiting } from '@/components/Waiting';
import { api, useAction, useCan } from '@/lib/api';
import { formatDateTime, formatDay, statusLabel } from '@/lib/format';
import { BackLink } from '@/components/BackLink';

export default function CompanyBillingPage() {
  const { companyId } = useParams<{ companyId: string }>();
  const router = useRouter();
  const canManage = useCan('billing.manage');
  const billing = useQuery({
    queryKey: ['billing', companyId],
    queryFn: () => api<CompanyBilling>(`/billing/companies/${companyId}`),
  });
  // Everything is selected unless unticked.
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const create = useAction(
    (body: { companyId: number; orderIds: number[]; adjustmentIds: number[] }) =>
      api<{ id: number }>('/billing/invoices', { body }),
    {
      success: 'Invoice created',
      invalidate: ['billing'],
      onSuccess: (invoice) => router.push(`/invoices/${invoice.id}`),
    },
  );
  const markPaid = useAction(
    (id: number) => api(`/billing/invoices/${id}/paid`, { method: 'POST' }),
    {
      success: 'Marked paid',
      invalidate: ['billing'],
    },
  );

  if (!billing.data) return <Waiting error={billing.error} />;
  const { company, unbilledOrders, unbilledCredits, invoices } = billing.data;
  const orders = unbilledOrders.filter((o) => !skipped.has(`o${o.id}`));
  const credits = unbilledCredits.filter((c) => !skipped.has(`c${c.id}`));
  const total = orders.reduce((s, o) => s + o.total, 0) + credits.reduce((s, c) => s + c.amount, 0);

  return (
    <Stack>
      <BackLink href="/billing">All companies’ billing</BackLink>
      <div>
        <Title order={2}>{company.name}</Title>
        <Text size="sm" c="dimmed">
          Bill to {company.billingName}, {company.billingEmail}
        </Text>
      </div>

      <Card withBorder>
        <Title order={4} mb="xs">
          Not invoiced yet
        </Title>
        {unbilledOrders.length + unbilledCredits.length === 0 ? (
          <Text c="dimmed">Everything is invoiced.</Text>
        ) : (
          <>
            <Table>
              <Table.Tbody>
                {unbilledOrders.map((o) => (
                  <Table.Tr key={`o${o.id}`}>
                    <Table.Td w={40}>
                      <Checkbox
                        aria-label={`Include order #${o.id}`}
                        checked={!skipped.has(`o${o.id}`)}
                        onChange={() => toggle(`o${o.id}`)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Link href={`/orders/${o.id}`}>#{o.id}</Link>
                    </Table.Td>
                    <Table.Td>{formatDay(o.deliveryDate)}</Table.Td>
                    <Table.Td>{o.employee}</Table.Td>
                    <Table.Td>{statusLabel(o.status)}</Table.Td>
                    <Table.Td ta="right">{formatMoney(o.total)}</Table.Td>
                  </Table.Tr>
                ))}
                {unbilledCredits.map((c) => (
                  <Table.Tr key={`c${c.id}`}>
                    <Table.Td>
                      <Checkbox
                        aria-label={`Include credit on order #${c.orderId}`}
                        checked={!skipped.has(`c${c.id}`)}
                        onChange={() => toggle(`c${c.id}`)}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Link href={`/orders/${c.orderId}`}>#{c.orderId}</Link>
                    </Table.Td>
                    <Table.Td colSpan={3}>Credit: {c.reason}</Table.Td>
                    <Table.Td ta="right">{formatMoney(c.amount)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {canManage && (
              <Group justify="flex-end" mt="sm">
                <Text fw={600}>Invoice total {formatMoney(total)}</Text>
                <Button
                  disabled={orders.length + credits.length === 0}
                  loading={create.isPending}
                  onClick={() =>
                    create.mutate({
                      companyId: company.id,
                      orderIds: orders.map((o) => o.id),
                      adjustmentIds: credits.map((c) => c.id),
                    })
                  }
                >
                  Create invoice
                </Button>
              </Group>
            )}
          </>
        )}
      </Card>

      <Card withBorder>
        <Title order={4} mb="xs">
          Invoices
        </Title>
        <Table>
          <Table.Tbody>
            {invoices.map((inv) => (
              <Table.Tr key={inv.id}>
                <Table.Td>
                  <Link href={`/invoices/${inv.id}`}>Invoice #{inv.id}</Link>
                </Table.Td>
                <Table.Td>{formatDateTime(inv.createdAt)}</Table.Td>
                <Table.Td>{inv.orderCount} orders</Table.Td>
                <Table.Td ta="right">{formatMoney(inv.total)}</Table.Td>
                <Table.Td>
                  {inv.paidAt ? (
                    <Badge color="green" variant="light">
                      Paid
                    </Badge>
                  ) : (
                    <Group gap="xs">
                      <Badge color="orange" variant="light">
                        Unpaid
                      </Badge>
                      {canManage && (
                        <Button
                          size="compact-xs"
                          variant="light"
                          loading={markPaid.isPending && markPaid.variables === inv.id}
                          onClick={() => markPaid.mutate(inv.id)}
                        >
                          Mark paid
                        </Button>
                      )}
                    </Group>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {invoices.length === 0 && <Text c="dimmed">No invoices yet.</Text>}
      </Card>
    </Stack>
  );
}
