'use client';

import { Title } from '@mantine/core';
import { OrderForm } from '@/components/OrderForm';
import { BackLink } from '@/components/BackLink';

export default function NewOrderPage() {
  return (
    <>
      <BackLink href="/orders">All orders</BackLink>
      <Title order={2} mb="md">
        New order
      </Title>
      <OrderForm />
    </>
  );
}
