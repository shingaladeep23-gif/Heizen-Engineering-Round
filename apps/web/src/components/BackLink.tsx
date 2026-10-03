import { Anchor } from '@mantine/core';
import Link from 'next/link';
import type { ReactNode } from 'react';

// "← All orders" above a detail page, so there's always an obvious way back.
export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Anchor component={Link} href={href} size="sm" display="inline-block" mb={4}>
      ← {children}
    </Anchor>
  );
}
