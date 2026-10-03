import { Injectable, NotFoundException } from '@nestjs/common';
import type { EmployeeMenu } from '@fernleaf/shared';
import { PrismaService } from '../prisma.service.js';
import { tierIdFor } from '../pricing/price-rules.js';
import { priceDish } from './menu-rules.js';

@Injectable()
export class MenuService {
  constructor(private readonly db: PrismaService) {}

  /**
   * The menu exactly as one employee sees it (spec 4.2 + 4.3): active and not
   * hidden from their company, priced on their company's tier, and without
   * anything that has no price there. Secret categories are left out of the
   * list unless asked for by id, or all of them when staff build an order
   * (they're "reachable", just not listed).
   */
  async menuFor(
    employeeId: number,
    secret: { openId?: number; all?: boolean } = {},
  ): Promise<EmployeeMenu> {
    const employee = await this.db.employee.findUnique({
      where: { id: employeeId },
      include: {
        allergies: true,
        dietaryPrefs: true,
        company: { include: { hiddenCategories: true, hiddenItems: true } },
      },
    });
    if (!employee) throw new NotFoundException({ message: 'Employee not found' });
    const { company } = employee;

    const settings = await this.db.settings.findUniqueOrThrow({ where: { id: 1 } });
    const tierId = tierIdFor(company.priceTierId, settings.defaultTierId);
    const tier = tierId ? await this.db.priceTier.findUnique({ where: { id: tierId } }) : null;
    const summary = { id: employee.id, name: employee.name, companyName: company.name };
    if (!tier)
      return { employee: summary, tierName: 'No price tier', categories: [], secretCategories: [] };

    // Portion size charges scale from the default tier's price (D75).
    const defaultTier =
      settings.defaultTierId === tier.id || !settings.defaultTierId
        ? tier
        : await this.db.priceTier.findUnique({ where: { id: settings.defaultTierId } });
    // Only this tier's prices, the default tier's, and their base tiers' are needed.
    const tierIds = [tier, defaultTier].flatMap((t) => (t ? [t.id, t.baseTierId ?? t.id] : []));
    const prices = { where: { tierId: { in: tierIds } } };
    const categories = await this.db.menuCategory.findMany({
      where: { active: true, id: { notIn: company.hiddenCategories.map((c) => c.id) } },
      orderBy: { position: 'asc' },
      include: {
        items: {
          where: {
            active: true,
            dish: { active: true },
            id: { notIn: company.hiddenItems.map((i) => i.id) },
          },
          orderBy: { position: 'asc' },
          include: {
            dish: {
              include: {
                allergens: true,
                dietaryTags: true,
                prices,
                optionGroups: {
                  orderBy: { position: 'asc' },
                  include: {
                    sizes: { orderBy: { position: 'asc' }, include: { size: true } },
                    options: {
                      orderBy: { position: 'asc' },
                      include: {
                        option: {
                          include: { allergens: true, dietaryTags: true, prices, sizes: true },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const toRule = (t: NonNullable<typeof tier>) => ({
      ...t,
      factor: t.factor?.toString() ?? null,
    });
    const rule = toRule(tier);
    const defaultRule = defaultTier ? toRule(defaultTier) : null;
    const diet = {
      allergies: employee.allergies.map((a) => a.name),
      dietaryPrefs: employee.dietaryPrefs.map((d) => d.name),
    };
    const listed = categories
      .filter((category) => !category.secret || secret.all || category.id === secret.openId)
      .map((category) => ({
        id: category.id,
        name: category.name,
        secret: category.secret,
        dishes: category.items.flatMap(
          (item) => priceDish(item.dish, rule, diet, defaultRule) ?? [],
        ),
      }))
      .filter((category) => category.dishes.length > 0);

    return {
      employee: summary,
      tierName: tier.name,
      categories: listed,
      secretCategories: categories.filter((c) => c.secret).map(({ id, name }) => ({ id, name })),
    };
  }
}
