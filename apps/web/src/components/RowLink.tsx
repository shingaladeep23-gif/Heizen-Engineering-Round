import { Anchor } from '@mantine/core';
import Link from 'next/link';
import type { ReactNode } from 'react';

// The main cell of a clickable table row. The whole row opens on click, but a
// real link is what the keyboard can reach and Ctrl-click opens in a new tab.
// It stops the click reaching the row, so the row doesn't navigate a second time.
export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Anchor component={Link} href={href} onClick={(e) => e.stopPropagation()}>
      {children}
    </Anchor>
  );
}
