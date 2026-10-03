// The checks against the live site create real rows there. This removes all
// of them again, so reviewers only ever see the demo data.
//
// It only touches what the checks mark as test data:
// - companies named "Fernleaf QA ..." whose domains are all on fernleaf-qa.in,
//   with their employees, orders, invoices and credits
// - dishes with an SKU starting "QA-", and options, tiers, menu categories,
//   reference list items (portion sizes too) and kitchen holidays whose
//   names start with "QA "
// - staff accounts on @fernleaf-qa.in
//
// One transaction: it removes everything or nothing. If anything outside the
// test data still points at a test row (it never should), the database
// refuses and nothing is removed.
import { PrismaClient } from '@prisma/client';

export const QA_DOMAIN = 'fernleaf-qa.in';

/**
 * Removes the test data, trying again if the database can't be reached for
 * a moment (a network blip, or Neon waking up). Each try is one transaction,
 * so a failed one leaves nothing half done and the next simply starts over.
 * If every try fails it says so loudly; the next live run also clears
 * leftovers before it starts.
 */
export async function removeQaData(databaseUrl: string, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await removeOnce(databaseUrl);
    } catch (error) {
      const why = String(error).split(/\r?\n/)[0];
      if (attempt >= tries) {
        throw new Error(
          `Couldn't remove the test data from the live site after ${tries} tries (${why}). ` +
            'Run the live checks again, or call removeQaData(), to clear it.',
        );
      }
      console.log(`Cleanup try ${attempt} failed (${why}); trying again in ${attempt * 5} s`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
    }
  }
}

async function removeOnce(databaseUrl: string) {
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const removed = await db.$transaction(
      async (tx) => {
        const companies = await tx.company.findMany({
          where: {
            name: { startsWith: 'Fernleaf QA' },
            domains: { some: {}, every: { domain: { endsWith: QA_DOMAIN } } },
          },
          select: { id: true },
        });
        const companyId = { in: companies.map((c) => c.id) };
        await tx.adjustment.deleteMany({ where: { order: { companyId } } });
        const orders = await tx.order.deleteMany({ where: { companyId } }); // lines cascade
        await tx.invoice.deleteMany({ where: { companyId } });
        await tx.company.updateMany({
          where: { id: companyId },
          data: { ownerId: null, defaultAddressId: null },
        });
        await tx.employee.deleteMany({ where: { companyId } });
        await tx.address.deleteMany({ where: { companyId } });
        await tx.company.deleteMany({ where: { id: companyId } }); // domains, holidays cascade

        const qaName = { startsWith: 'QA ' };
        const dishes = { sku: { startsWith: 'QA-' } };
        await tx.menuCategory.deleteMany({ where: { name: qaName } }); // its items cascade
        await tx.menuItem.deleteMany({ where: { dish: dishes } });
        await tx.dishPrice.deleteMany({ where: { dish: dishes } });
        await tx.dish.deleteMany({ where: dishes }); // option groups cascade
        await tx.optionGroupOption.deleteMany({ where: { option: { name: qaName } } });
        await tx.optionPrice.deleteMany({ where: { option: { name: qaName } } });
        await tx.option.deleteMany({ where: { name: qaName } });
        // Tiers derived from another QA tier go first.
        await tx.priceTier.deleteMany({ where: { name: qaName, baseTier: { name: qaName } } });
        await tx.priceTier.deleteMany({ where: { name: qaName } }); // their prices cascade
        await tx.allergen.deleteMany({ where: { name: qaName } });
        await tx.dietaryTag.deleteMany({ where: { name: qaName } });
        await tx.station.deleteMany({ where: { name: qaName } });
        await tx.packagingType.deleteMany({ where: { name: qaName } });
        await tx.portionSize.deleteMany({ where: { name: qaName } });
        await tx.kitchenHoliday.deleteMany({ where: { name: qaName } });
        await tx.user.deleteMany({ where: { email: { endsWith: `@${QA_DOMAIN}` } } });
        return { companies: companies.length, orders: orders.count };
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    console.log(`Removed test data: ${removed.companies} companies, ${removed.orders} orders`);
  } finally {
    await db.$disconnect();
  }
}

// Playwright's global setup for runs against the live site: clear anything a
// stopped run left behind, then clear this run's data when it finishes.
export default async function liveSetup() {
  const url = process.env.QA_DATABASE_URL;
  if (!url) {
    throw new Error(
      'Set QA_DATABASE_URL to the live database. The live checks create test data ' +
        'and must be able to remove it again afterwards.',
    );
  }
  await removeQaData(url);
  return () => removeQaData(url);
}
