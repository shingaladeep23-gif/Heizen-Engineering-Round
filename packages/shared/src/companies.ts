// Companies, employees and platform settings (spec 4.4, 4.5, 4.10).
import { z } from 'zod';

// Free email providers: a company can't claim these as its domain (spec 4.4).
export const PUBLIC_EMAIL_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'zoho.com',
  'rediffmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm, e.g. 12:30');
const weekdays = z
  .array(z.int().min(1).max(7))
  .min(1, 'Pick at least one day')
  .transform((days) => [...new Set(days)].sort());
const holidays = z.array(z.object({ date: z.iso.date(), name: z.string().trim().min(1, 'Name it') })).default([]);

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

// Checked on the whole list, so the error shows on the field itself.
const domainList = z
  .array(z.string().trim().toLowerCase())
  .min(1, 'Add at least one email domain')
  .refine((list) => list.every((d) => DOMAIN.test(d)), 'Not a domain, e.g. acme.in')
  .refine(
    (list) => list.every((d) => !PUBLIC_EMAIL_DOMAINS.includes(d)),
    'Public email domains are not allowed',
  )
  .refine((list) => new Set(list).size === list.length, 'Each domain once');

export const companySchema = z.object({
  name: z.string().trim().min(1, 'Required'),
  domains: domainList,
  // Existing addresses keep their id (orders point at them); new ones have none.
  addresses: z
    .array(
      z.object({
        id: z.int().optional(),
        label: z.string().trim().min(1, 'Required'),
        text: z.string().trim().min(1, 'Required'),
      }),
    )
    .min(1, 'Add at least one delivery address'),
  defaultAddressIndex: z.int().min(0).default(0),
  billingName: z.string().trim().min(1, 'Required'),
  billingEmail: z.email('Enter a valid email'),
  billingPhone: z.string().trim().nullable().default(null),
  ownerId: z.int().nullable().default(null),
  workingDays: weekdays,
  holidays,
  deliveryTime: time,
  dispatchLeadMinutes: z.int().min(0).max(600),
  packagingTypeId: z.int().nullable().default(null),
  driverInstructions: z.string().trim().max(500).default(''),
  defaultDriverId: z.int().nullable().default(null),
  priceTierId: z.int().nullable().default(null), // null = the default tier
  hiddenCategoryIds: z.array(z.int()).default([]),
  hiddenItemIds: z.array(z.int()).default([]),
});
export type CompanyInput = z.input<typeof companySchema>;

export const employeeSchema = z.object({
  companyId: z.int('Pick a company'),
  name: z.string().trim().min(1, 'Required'),
  email: z.email('Enter a valid email').transform((e) => e.toLowerCase()),
  canChooseAddress: z.boolean().default(false),
  canChangeTime: z.boolean().default(false),
  canChangePackaging: z.boolean().default(false),
  allergyIds: z.array(z.int()).default([]),
  dietaryIds: z.array(z.int()).default([]),
});
export type EmployeeInput = z.input<typeof employeeSchema>;

export const settingsSchema = z.object({
  kitchenWorkingDays: weekdays,
  cutoffTime: time,
  cutoffDays: z.int().min(0).max(14),
  kitchenBufferMinutes: z.int().min(0).max(600),
  atRiskMinutes: z.int().min(0).max(600),
  onTimeGraceMinutes: z.int().min(0).max(240),
  holidays,
});
export type SettingsInput = z.input<typeof settingsSchema>;

export type CompanyRow = {
  id: number;
  name: string;
  domains: string[];
  tier: string | null;
  employees: number;
};

export type CompanyDetail = Required<Omit<CompanyInput, 'holidays'>> & {
  id: number;
  holidays: { date: string; name: string }[];
  employees: {
    id: number;
    name: string;
    email: string;
    canChooseAddress: boolean;
    canChangeTime: boolean;
    canChangePackaging: boolean;
    allergyIds: number[];
    dietaryIds: number[];
  }[];
};
