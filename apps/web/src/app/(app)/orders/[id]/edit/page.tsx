'use client';

import type { OrderDetail } from '@fernleaf/shared';
import { Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { OrderForm, valuesFromOrder } from '@/components/OrderForm';
import { Waiting } from '@/components/Waiting';
import { api } from '@/lib/api';
import { BackLink } from '@/components/BackLink';

export default function EditOrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/orders/${id}`),
  });
  if (!order.data) return <Waiting error={order.error} />;
  return (
    <>
      <BackLink href={`/orders/${id}`}>Back to order #{id}</BackLink>
      <Title order={2} mb="md">
        Edit order #{id}
      </Title>
      <OrderForm orderId={order.data.id} initial={valuesFromOrder(order.data)} />
    </>
  );
}
