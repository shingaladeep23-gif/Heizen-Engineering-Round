import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  can,
  type CompanyDetail,
  type CompanyRow,
  type ImportResult,
  type companySchema,
  type employeeSchema,
} from '@fernleaf/shared';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { PrismaService } from '../prisma.service.js';
import { dayOf } from '../orders/calendar.js';
import { checkRows } from './employee-import.js';

type CompanyBody = z.output<typeof companySchema>;
type EmployeeBody = z.output<typeof employeeSchema>;
type Tx = Prisma.TransactionClient;

const bad = (field: string, message: string) =>
  new BadRequestException({ message, fieldErrors: { [field]: message } });
const domainOf = (email: string) => email.split('@')[1] ?? '';
const ids = (list: number[]) => list.map((id) => ({ id }));

@Injectable()
export class CompaniesService {
  constructor(private readonly db: PrismaService) {}

  async list(): Promise<CompanyRow[]> {
    const companies = await this.db.company.findMany({
      orderBy: { name: 'asc' },
      include: { domains: true, priceTier: true, _count: { select: { employees: true } } },
    });
    return companies.map((c) => ({
      id: c.id,
      name: c.name,
      domains: c.domains.map((d) => d.domain),
      tier: c.priceTier?.name ?? null,
      employees: c._count.employees,
    }));
  }

  async detail(id: number): Promise<CompanyDetail> {
    const c = await this.db.company.findUnique({
      where: { id },
      include: {
        domains: true,
        addresses: { orderBy: { id: 'asc' } },
        holidays: { orderBy: { date: 'asc' } },
        hiddenCategories: { select: { id: true } },
        hiddenItems: { select: { id: true } },
        employees: {
          orderBy: { name: 'asc' },
          include: { allergies: { select: { id: true } }, dietaryPrefs: { select: { id: true } } },
        },
      },
    });
    if (!c) throw new NotFoundException({ message: 'Company not found' });
    return {
      id: c.id,
      name: c.name,
      domains: c.domains.map((d) => d.domain),
      addresses: c.addresses.map(({ id, label, text }) => ({ id, label, text })),
      defaultAddressIndex: Math.max(
        0,
        c.addresses.findIndex((a) => a.id === c.defaultAddressId),
      ),
      billingName: c.billingName,
      billingEmail: c.billingEmail,
      billingPhone: c.billingPhone,
      ownerId: c.ownerId,
      workingDays: c.workingDays,
      holidays: c.holidays.map((h) => ({ date: dayOf(h.date), name: h.name })),
      deliveryTime: c.deliveryTime,
      dispatchLeadMinutes: c.dispatchLeadMinutes,
      packagingTypeId: c.packagingTypeId,
      driverInstructions: c.driverInstructions,
      defaultDriverId: c.defaultDriverId,
      priceTierId: c.priceTierId,
      hiddenCategoryIds: c.hiddenCategories.map((h) => h.id),
      hiddenItemIds: c.hiddenItems.map((h) => h.id),
      employees: c.employees.map((e) => ({
        id: e.id,
        name: e.name,
        email: e.email,
        canChooseAddress: e.canChooseAddress,
        canChangeTime: e.canChangeTime,
        canChangePackaging: e.canChangePackaging,
        allergyIds: e.allergies.map((a) => a.id),
        dietaryIds: e.dietaryPrefs.map((d) => d.id),
      })),
    };
  }

  /** Creates (id = null) or updates a company with all its parts in one transaction. */
  async save(id: number | null, input: CompanyBody) {
    return this.db.$transaction(async (tx) => {
      await this.checkDomains(tx, id, input.domains);
      await this.checkDriver(tx, input.defaultDriverId);
      if (input.defaultAddressIndex >= input.addresses.length) {
        throw bad('defaultAddressIndex', 'Pick one of the addresses as the default');
      }

      const fields = {
        name: input.name,
        billingName: input.billingName,
        billingEmail: input.billingEmail,
        billingPhone: input.billingPhone,
        workingDays: input.workingDays,
        deliveryTime: input.deliveryTime,
        dispatchLeadMinutes: input.dispatchLeadMinutes,
        packagingTypeId: input.packagingTypeId,
        driverInstructions: input.driverInstructions,
        defaultDriverId: input.defaultDriverId,
        priceTierId: input.priceTierId,
      };
      const company =
        id === null
          ? await tx.company.create({ data: fields })
          : await tx.company.update({ where: { id }, data: fields });

      // Domains: replace the set (uniqueness across companies checked above).
      await tx.companyDomain.deleteMany({ where: { companyId: company.id } });
      await tx.companyDomain.createMany({
        data: input.domains.map((domain) => ({ domain, companyId: company.id })),
      });

      const addressIds = await this.saveAddresses(tx, company.id, input.addresses);

      await tx.companyHoliday.deleteMany({ where: { companyId: company.id } });
      await tx.companyHoliday.createMany({
        data: input.holidays.map((h) => ({
          companyId: company.id,
          date: new Date(h.date),
          name: h.name,
        })),
        skipDuplicates: true,
      });

      if (input.ownerId !== null) {
        const owner = await tx.employee.findUnique({ where: { id: input.ownerId } });
        if (owner?.companyId !== company.id)
          throw bad('ownerId', 'The owner must be one of this company’s employees');
      }

      return tx.company.update({
        where: { id: company.id },
        data: {
          ownerId: input.ownerId,
          defaultAddressId: addressIds[input.defaultAddressIndex],
          hiddenCategories: { set: ids(input.hiddenCategoryIds) },
          hiddenItems: { set: ids(input.hiddenItemIds) },
        },
      });
    });
  }

  // Two companies can't claim a domain, and a domain still used by an
  // employee's email can't be dropped (D18).
  private async checkDomains(tx: Tx, companyId: number | null, domains: string[]) {
    const taken = await tx.companyDomain.findMany({
      where: { domain: { in: domains }, companyId: { not: companyId ?? -1 } },
      include: { company: true },
    });
    if (taken.length) {
      throw bad('domains', `${taken[0].domain} already belongs to ${taken[0].company.name}`);
    }
    if (companyId !== null) {
      const employees = await tx.employee.findMany({ where: { companyId } });
      const orphaned = employees.filter((e) => !domains.includes(domainOf(e.email)));
      if (orphaned.length) {
        throw bad(
          'domains',
          `${orphaned.length} employee(s) still use @${domainOf(orphaned[0].email)}`,
        );
      }
    }
  }

  private async checkDriver(tx: Tx, driverId: number | null) {
    if (driverId === null) return;
    const driver = await tx.user.findUnique({ where: { id: driverId } });
    if (!driver?.active || !can(driver.role, 'deliveries.own')) {
      throw bad('defaultDriverId', 'Pick an active driver');
    }
  }

  // Addresses keep their ids (orders point at them). Ones that were removed
  // are deleted, unless an order still uses them.
  private async saveAddresses(tx: Tx, companyId: number, addresses: CompanyBody['addresses']) {
    const existing = await tx.address.findMany({
      where: { companyId },
      include: { _count: { select: { orders: true } } },
    });
    const keep = new Set(addresses.flatMap((a) => (a.id ? [a.id] : [])));
    for (const old of existing.filter((a) => !keep.has(a.id))) {
      if (old._count.orders > 0) {
        throw bad(
          'addresses',
          `"${old.label}" has orders, so it can't be removed. Rename it instead.`,
        );
      }
      await tx.company.updateMany({
        where: { defaultAddressId: old.id },
        data: { defaultAddressId: null },
      });
      await tx.address.delete({ where: { id: old.id } });
    }
    const saved: number[] = [];
    for (const address of addresses) {
      if (address.id && existing.some((a) => a.id === address.id)) {
        await tx.address.update({
          where: { id: address.id },
          data: { label: address.label, text: address.text },
        });
        saved.push(address.id);
      } else {
        const created = await tx.address.create({
          data: { companyId, label: address.label, text: address.text },
        });
        saved.push(created.id);
      }
    }
    return saved;
  }

  /**
   * Creates or updates an employee. Their email must be on one of their
   * company's domains, so moving them to another company may mean a new email.
   * Past orders stay with the company they were placed under.
   */
  async saveEmployee(id: number | null, input: EmployeeBody) {
    const company = await this.db.company.findUnique({
      where: { id: input.companyId },
      include: { domains: true },
    });
    if (!company) throw bad('companyId', 'Pick a company');
    const domains = company.domains.map((d) => d.domain);
    if (!domains.includes(domainOf(input.email))) {
      throw bad('email', `Must be an address at ${domains.map((d) => `@${d}`).join(' or ')}`);
    }
    if (id !== null) {
      const current = await this.db.employee.findUnique({
        where: { id },
        include: { ownerOf: true },
      });
      if (!current) throw new NotFoundException({ message: 'Employee not found' });
      if (current.ownerOf && current.companyId !== input.companyId) {
        throw new ConflictException({
          message: `${current.name} owns ${current.ownerOf.name}. Pick a new owner there before moving them.`,
        });
      }
    }
    const data = {
      companyId: input.companyId,
      name: input.name,
      email: input.email,
      canChooseAddress: input.canChooseAddress,
      canChangeTime: input.canChangeTime,
      canChangePackaging: input.canChangePackaging,
      allergies: { set: ids(input.allergyIds) },
      dietaryPrefs: { set: ids(input.dietaryIds) },
    };
    return id === null
      ? this.db.employee.create({
          data: {
            ...data,
            allergies: { connect: ids(input.allergyIds) },
            dietaryPrefs: { connect: ids(input.dietaryIds) },
          },
        })
      : this.db.employee.update({ where: { id }, data });
  }

  /** Bulk-adds employees from a CSV file. Good rows go in; bad rows are reported, not fatal. */
  async importEmployees(companyId: number, csv: string): Promise<ImportResult> {
    const company = await this.db.company.findUnique({
      where: { id: companyId },
      include: { domains: true },
    });
    if (!company) throw new NotFoundException({ message: 'Company not found' });
    const [employees, allergens, tags] = await Promise.all([
      this.db.employee.findMany({ select: { email: true } }),
      this.db.allergen.findMany(),
      this.db.dietaryTag.findMany(),
    ]);
    const byName = (rows: { id: number; name: string }[]) =>
      new Map(rows.map((r) => [r.name.toLowerCase(), r.id]));
    const { rows, errors } = checkRows(csv, {
      domains: company.domains.map((d) => d.domain),
      existingEmails: new Set(employees.map((e) => e.email.toLowerCase())),
      allergens: byName(allergens),
      dietaryTags: byName(tags),
    });

    let created = 0;
    for (const row of rows) {
      try {
        await this.db.employee.create({
          data: {
            companyId,
            name: row.name,
            email: row.email,
            canChooseAddress: row.canChooseAddress,
            canChangeTime: row.canChangeTime,
            canChangePackaging: row.canChangePackaging,
            allergies: { connect: ids(row.allergyIds) },
            dietaryPrefs: { connect: ids(row.dietaryIds) },
          },
        });
        created++;
      } catch (error) {
        // Someone added the same email at the same moment: report it like any other row.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'))
          throw error;
        errors.push({ row: row.row, email: row.email, problems: ['Already an employee'] });
      }
    }
    return { created, errors: errors.sort((a, b) => a.row - b.row) };
  }
}
