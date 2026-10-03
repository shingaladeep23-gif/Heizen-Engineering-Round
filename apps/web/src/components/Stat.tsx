import { Card, Text } from '@mantine/core';
import type { ReactNode } from 'react';

// One number with a label, and an optional line explaining it.
export function Stat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  color?: string;
}) {
  return (
    <Card withBorder padding="sm">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      {/* Colour only draws attention when there's something there: 0 late isn't red. */}
      <Text fw={700} size="xl" c={value ? color : undefined}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Card>
  );
}
