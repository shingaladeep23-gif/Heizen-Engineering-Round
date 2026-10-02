// Validation rules shared by the API (enforced) and the web forms (for nicer UX).
import { z } from 'zod';
import { ROLES, type Role } from './permissions.js';

export const loginSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z
    .string({ error: 'Enter your password' })
    .min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const staffSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.email('Enter a valid email'),
  password: z.string().min(8, 'At least 8 characters'),
  role: z.enum(ROLES),
});
export type StaffInput = z.infer<typeof staffSchema>;

export type Me = { id: number; name: string; email: string; role: Role };

// Shape of every error the API returns, so the UI can show it the same way.
export type ApiErrorBody = {
  message: string;
  fieldErrors?: Record<string, string>;
};
