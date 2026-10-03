// Orders: validation for the forms and the API, plus the shapes the API returns.
import { z } from 'zod';

export const ORDER_STATUSES = [
  'DRAFT',
  'PLACED',
  'CONFIRMED',
  'DELIVERED',
  'CANCELLED',
  'REJECTED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const day = z.iso.date('Pick a date');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 12:30');

export const orderSchema = z.object({
  employeeId: z.int('Pick an employee'),
  deliveryDate: day,
  // Leave out to use the company default. Changing them needs the employee's permission.
  deliveryTime: time.nullable().default(null),
  addressId: z.int().nullable().default(null),
  packagingTypeId: z.int().nullable().default(null),
  lines: z
    .array(
      z.object({
        dishId: z.int(),
        quantity: z.int().min(1, 'At least 1'),
        combos: z
          .array(
            z.object({
              quantity: z.int().min(1, 'At least 1'),
              optionIds: z.array(z.int()).default([]),
            }),
          )
          .min(1, 'Add at least one combination'),
      }),
    )
    .min(1, 'Add at least one dish'),
  place: z.boolean().default(false), // false = save as draft
});
export type OrderInput = z.input<typeof orderSchema>;

export const deliveryOverrideSchema = z.object({
  deliveryTime: time,
  addressId: z.int(),
  packagingTypeId: z.int().nullable(),
});
export type DeliveryOverride = z.infer<typeof deliveryOverrideSchema>;

export const rejectSchema = z.object({ reason: z.string().trim().min(3, 'Say why') });
export const cutoffRunSchema = z.object({ date: day });

export type Choice = { groupName: string; optionId: number; optionName: string; price: number };

export type OrderListItem = {
  id: number;
  status: OrderStatus;
  deliveryDate: string;
  deliveryTime: string;
  total: number;
  invoiced: boolean;
  employee: { name: string };
  company: { name: string };
};
export type OrderPage = { items: OrderListItem[]; total: number; page: number; pageSize: number };

export type OrderDetail = {
  id: number;
  status: OrderStatus;
  deliveryDate: string;
  deliveryTime: string;
  total: number;
  employee: { id: number; name: string; email: string };
  company: { id: number; name: string; driverInstructions: string };
  address: { id: number; label: string; text: string };
  packagingType: { id: number; name: string } | null;
  driver: { name: string } | null;
  invoice: { id: number; paidAt: string | null } | null;
  rejectReason: string | null;
  deliveryNote: string | null;
  deliveryPhoto: string | null;
  deliveredOnTime: boolean | null;
  lines: {
    id: number;
    dishId: number;
    dishName: string;
    dishPrice: number;
    quantity: number;
    total: number;
    combos: { id: number; quantity: number; unitPrice: number; total: number; choices: Choice[] }[];
  }[];
  adjustments: { id: number; amount: number; reason: string; createdAt: string }[];
  cutoffAt: string;
  cutoffPassed: boolean;
  plan: { dispatchReadyBy: string; kitchenReadyBy: string };
  timeline: { label: string; at: string }[];
  can: {
    edit: boolean;
    cancel: boolean;
    reject: boolean;
    override: boolean;
    completeKitchen: boolean;
  };
};

// What the order form needs to know about an employee on a given date.
export type DeliveryInfo = {
  cutoffAt: string | null;
  cutoffPassed: boolean;
  problems: string[]; // reasons the date can't be used
  defaults: { deliveryTime: string; addressId: number | null; packagingTypeId: number | null };
  allowed: { address: boolean; time: boolean; packaging: boolean };
  addresses: { id: number; label: string; text: string }[];
};
