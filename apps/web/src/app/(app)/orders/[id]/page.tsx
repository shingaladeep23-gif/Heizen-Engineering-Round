'use client';

import { formatMoney, type DeliveryInfo, type OrderDetail } from '@fernleaf/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Timeline,
  Title,
} from '@mantine/core';
import { TimeInput } from '@mantine/dates';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { MoneyInput } from '@/components/MoneyInput';
import { valuesFromOrder } from '@/components/OrderForm';
import { Waiting } from '@/components/Waiting';
import { api, useAction, useCan, useLists } from '@/lib/api';
import { formatDateTime, formatDay, formatTime, STATUS_COLORS, statusLabel } from '@/lib/format';

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <Text size="xs" c="dimmed">
      {label}
    </Text>
    <Text size="sm">{children}</Text>
  </div>
);

function DeliveryOverride({ order, onDone }: { order: OrderDetail; onDone: () => void }) {
  const lists = useLists();
  const info = useQuery({
    queryKey: ['delivery-info', order.employee.id, order.deliveryDate],
    queryFn: () =>
      api<DeliveryInfo>(
        `/orders/delivery-info?employeeId=${order.employee.id}&date=${order.deliveryDate}`,
      ),
  });
  const [time, setTime] = useState(order.deliveryTime);
  const [addressId, setAddressId] = useState(String(order.address.id));
  const [packagingId, setPackagingId] = useState<string | null>(
    order.packagingType ? String(order.packagingType.id) : null,
  );
  const save = useAction(
    () =>
      api(`/orders/${order.id}/delivery`, {
        method: 'PUT',
        body: {
          deliveryTime: time,
          addressId: Number(addressId),
          packagingTypeId: packagingId ? Number(packagingId) : null,
        },
      }),
    { success: 'Delivery details changed', invalidate: ['order'], onSuccess: onDone },
  );
  return (
    <Stack>
      <Text size="sm">
        Admin override. The kitchen and dispatch plan moves with the new time automatically.
      </Text>
      <TimeInput
        label="Delivery time"
        value={time}
        onChange={(e) => setTime(e.currentTarget.value)}
      />
      <Select
        label="Address"
        data={(info.data?.addresses ?? []).map((a) => ({ value: String(a.id), label: a.label }))}
        value={addressId}
        onChange={(v) => v && setAddressId(v)}
      />
      <Select
        label="Packaging"
        clearable
        data={(lists.data?.['packaging-types'] ?? []).map((p) => ({
          value: String(p.id),
          label: p.name,
        }))}
        value={packagingId}
        onChange={setPackagingId}
      />
      <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
        Save delivery details
      </Button>
    </Stack>
  );
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/orders/${id}`),
  });
  const [dialog, setDialog] = useState<'reject' | 'delivery' | 'cancel' | 'credit' | null>(null);
  const canBill = useCan('billing.manage');
  const [creditAmount, setCreditAmount] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  // Each dialog starts empty, so a reason typed for one never turns up in another.
  const close = () => {
    setDialog(null);
    setReason('');
    setCreditAmount(null);
  };
  const done = { invalidate: ['order', 'orders'], onSuccess: close };

  const place = useAction(
    () =>
      api(`/orders/${id}`, {
        method: 'PUT',
        body: { ...valuesFromOrder(order.data!), place: true },
      }),
    { success: 'Order placed', ...done },
  );
  const cancel = useAction(() => api(`/orders/${id}/cancel`, { method: 'POST' }), {
    success: 'Order cancelled',
    ...done,
  });
  const completeKitchen = useAction(
    () => api(`/kitchen/orders/${id}/complete`, { method: 'POST' }),
    { success: 'Every unit marked cooked', ...done },
  );
  const credit = useAction(
    () => api(`/billing/orders/${id}/credit`, { body: { amount: creditAmount ?? 0, reason } }),
    { success: 'Credit recorded', ...done },
  );
  const reject = useAction(() => api(`/orders/${id}/reject`, { body: { reason } }), {
    success: 'Order rejected',
    ...done,
  });

  if (!order.data) return <Waiting error={order.error} />;
  const o = order.data;

  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Title order={2}>Order #{o.id}</Title>
          <Badge size="lg" color={STATUS_COLORS[o.status]} variant="light">
            {statusLabel(o.status)}
          </Badge>
          {o.invoice && <Badge variant="outline">Invoice #{o.invoice.id}</Badge>}
        </Group>
        <Group>
          {o.can.edit && (
            <Button variant="default" component={Link} href={`/orders/${o.id}/edit`}>
              Edit
            </Button>
          )}
          {o.can.edit && o.status === 'DRAFT' && (
            <Button loading={place.isPending} onClick={() => place.mutate(undefined)}>
              Place order
            </Button>
          )}
          {o.can.override && (
            <Button variant="light" onClick={() => setDialog('delivery')}>
              Change delivery
            </Button>
          )}
          {o.can.completeKitchen && (
            <Button
              variant="light"
              loading={completeKitchen.isPending}
              onClick={() => completeKitchen.mutate(undefined)}
            >
              Mark all cooked
            </Button>
          )}
          {canBill && o.status === 'DELIVERED' && (
            <Button variant="light" onClick={() => setDialog('credit')}>
              Credit short delivery
            </Button>
          )}
          {o.can.reject && (
            <Button variant="light" color="orange" onClick={() => setDialog('reject')}>
              Reject
            </Button>
          )}
          {o.can.cancel && (
            <Button variant="light" color="red" onClick={() => setDialog('cancel')}>
              Cancel order
            </Button>
          )}
        </Group>
      </Group>

      {o.rejectReason && <Alert color="red">Rejected: {o.rejectReason}</Alert>}

      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Card withBorder>
          <Stack gap="xs">
            <Field label="Employee">
              {o.employee.name} ({o.employee.email})
            </Field>
            <Field label="Company">{o.company.name}</Field>
            <Field label="Cut-off">
              {formatDateTime(o.cutoffAt)} {o.cutoffPassed ? '(passed)' : ''}
            </Field>
          </Stack>
        </Card>
        <Card withBorder>
          <Stack gap="xs">
            <Field label="Delivery">
              {formatDay(o.deliveryDate)}, {o.deliveryTime}
            </Field>
            <Field label="Address">
              {o.address.label}, {o.address.text}
            </Field>
            <Field label="Packaging">{o.packagingType?.name ?? 'None'}</Field>
            <Field label="Driver">{o.driver?.name ?? 'Not assigned yet'}</Field>
            {o.company.driverInstructions && (
              <Field label="Driver instructions">{o.company.driverInstructions}</Field>
            )}
          </Stack>
        </Card>
        <Card withBorder>
          <Stack gap="xs">
            <Field label="Kitchen ready by (planned)">{formatTime(o.plan.kitchenReadyBy)}</Field>
            <Field label="Leaves the kitchen by (planned)">
              {formatTime(o.plan.dispatchReadyBy)}
            </Field>
            {o.deliveredOnTime !== null && (
              <Field label="Delivered on time">{o.deliveredOnTime ? 'Yes' : 'No, late'}</Field>
            )}
            {o.deliveryNote && <Field label="Driver's note">{o.deliveryNote}</Field>}
            {o.deliveryPhoto && (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL, nothing to optimise
              <img
                src={o.deliveryPhoto}
                alt="Proof of delivery"
                style={{ maxWidth: '100%', borderRadius: 4 }}
              />
            )}
          </Stack>
        </Card>
      </SimpleGrid>

      <Card withBorder>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Item</Table.Th>
              <Table.Th>Choices</Table.Th>
              <Table.Th ta="right">Qty</Table.Th>
              <Table.Th ta="right">Each</Table.Th>
              <Table.Th ta="right">Amount</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {o.lines.flatMap((line) => [
              <Table.Tr key={`line-${line.id}`} fw={600}>
                <Table.Td>{line.dishName}</Table.Td>
                <Table.Td c="dimmed">{formatMoney(line.dishPrice)} base</Table.Td>
                <Table.Td ta="right">{line.quantity}</Table.Td>
                <Table.Td />
                <Table.Td ta="right">{formatMoney(line.total)}</Table.Td>
              </Table.Tr>,
              ...line.combos.map((combo) => (
                <Table.Tr key={`combo-${combo.id}`}>
                  <Table.Td />
                  <Table.Td>
                    {combo.choices.length
                      ? combo.choices
                          .map((c) =>
                            c.size
                              ? `${c.optionName}, ${c.size.name} (+${formatMoney(c.price + c.size.extra)})`
                              : `${c.optionName} (+${formatMoney(c.price)})`,
                          )
                          .join(', ')
                      : 'No choices'}
                  </Table.Td>
                  <Table.Td ta="right">{combo.quantity}</Table.Td>
                  <Table.Td ta="right">{formatMoney(combo.unitPrice)}</Table.Td>
                  <Table.Td ta="right">{formatMoney(combo.total)}</Table.Td>
                </Table.Tr>
              )),
            ])}
            <Table.Tr>
              <Table.Td colSpan={4} ta="right" fw={700}>
                Order total
              </Table.Td>
              <Table.Td ta="right" fw={700}>
                {formatMoney(o.total)}
              </Table.Td>
            </Table.Tr>
            {o.adjustments.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td colSpan={4} ta="right" c="dimmed">
                  Adjustment: {a.reason}
                </Table.Td>
                <Table.Td ta="right">{formatMoney(a.amount)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="xs" c="dimmed" mt="xs">
          Prices are fixed at the time the order was saved. Later catalogue or price changes
          don&apos;t affect this order.
        </Text>
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">
          Timeline
        </Title>
        <Timeline active={o.timeline.length - 1} bulletSize={14}>
          {o.timeline.map((event) => (
            <Timeline.Item key={event.label} title={event.label}>
              <Text size="xs" c="dimmed">
                {formatDateTime(event.at)}
              </Text>
            </Timeline.Item>
          ))}
        </Timeline>
      </Card>

      <Modal opened={dialog === 'cancel'} onClose={close} title={`Cancel order #${o.id}?`}>
        <Stack>
          <Text size="sm">
            {o.invoice
              ? 'This order is already invoiced, so a credit for the full amount will go on the company’s next invoice.'
              : 'The company won’t be billed for it.'}
          </Text>
          <Button color="red" loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>
            Yes, cancel it
          </Button>
        </Stack>
      </Modal>
      <Modal opened={dialog === 'reject'} onClose={close} title={`Reject order #${o.id}`}>
        <Stack>
          <Textarea
            label="Reason"
            placeholder="e.g. Out of paneer for this date"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button
            color="orange"
            loading={reject.isPending}
            onClick={() => reject.mutate(undefined)}
          >
            Reject order
          </Button>
        </Stack>
      </Modal>
      <Modal opened={dialog === 'credit'} onClose={close} title={`Credit order #${o.id}`}>
        <Stack>
          <Text size="sm">
            For an order that turned out short. The credit comes off the company&apos;s next
            invoice; invoices already sent never change.
          </Text>
          <MoneyInput label="Amount to credit" value={creditAmount} onChange={setCreditAmount} />
          <Textarea
            label="Reason"
            placeholder="e.g. 2 bowls missing from the drop"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
          />
          <Button loading={credit.isPending} onClick={() => credit.mutate(undefined)}>
            Record credit
          </Button>
        </Stack>
      </Modal>
      <Modal opened={dialog === 'delivery'} onClose={close} title="Change delivery details">
        <DeliveryOverride order={o} onDone={close} />
      </Modal>
    </Stack>
  );
}
