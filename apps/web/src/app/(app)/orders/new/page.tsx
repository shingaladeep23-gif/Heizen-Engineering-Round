'use client';

import { Title } from '@mantine/core';
import { OrderForm } from '@/components/OrderForm';

export default function NewOrderPage() {
  return (
    <>
      <Title order={2} mb="md">
        New order
      </Title>
      <OrderForm />
    </>
  );
}
