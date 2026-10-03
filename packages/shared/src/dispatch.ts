// Dispatch: orders for the same company, address and exact delivery time
// make up one drop, and move through each step together (spec 4.8).
import { z } from 'zod';

export const DROP_STEPS = ['dispatch-ready', 'out', 'delivered'] as const;
export type DropStep = (typeof DROP_STEPS)[number];
export type DropStage = 'cooking' | 'kitchen-ready' | 'dispatch-ready' | 'out' | 'delivered';

export const dropRefSchema = z.object({
  companyId: z.int(),
  addressId: z.int(),
  date: z.iso.date(),
  time: z.string().regex(/^\d\d:\d\d$/),
});
export type DropRef = z.infer<typeof dropRefSchema>;

export const assignDriverSchema = z.object({ drop: dropRefSchema, driverId: z.int() });
export const stepSchema = z.object({ drop: dropRefSchema, step: z.enum(DROP_STEPS) });
export const deliverSchema = z.object({
  drop: dropRefSchema,
  note: z.string().trim().max(500).default(''),
  // A small JPEG the browser has already resized, as a data URL.
  photo: z
    .string()
    .startsWith('data:image/', 'Not an image')
    .max(1_500_000, 'Photo is too large')
    .nullable()
    .default(null),
});
export type DeliverInput = z.input<typeof deliverSchema>;

export type Drop = {
  ref: DropRef;
  company: { id: number; name: string };
  address: { id: number; label: string; text: string };
  driverInstructions: string;
  driver: { id: number; name: string } | null;
  stage: DropStage;
  dispatchReadyBy: string; // planned
  late: boolean; // not out of the door by its planned time, or delivered late
  deliveredAt: string | null;
  deliveredOnTime: boolean | null;
  note: string | null;
  orders: { id: number; employee: string; items: string; kitchenReady: boolean }[];
  portions: number;
};
