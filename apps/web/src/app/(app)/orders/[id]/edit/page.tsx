'use client';

import type { OrderDetail } from '@fernleaf/shared';
import { Loader, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { OrderForm, valuesFromOrder } from '@/components/OrderForm';
import { api } from '@/lib/api';

export default function EditOrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useQuery({
    queryKey: ['order', id],
    queryFn: () => api<OrderDetail>(`/orders/${id}`),
  });
  if (!order.data) return <Loader />;
  return (
    <>
      <Title order={2} mb="md">
        Edit order #{id}
      </Title>
      <OrderForm orderId={order.data.id} initial={valuesFromOrder(order.data)} />
    </>
  );
}
