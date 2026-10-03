import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  dishSchema,
  LIST_KINDS,
  listItemSchema,
  optionSchema,
  type ListKind,
  type Lists,
} from '@fernleaf/shared';
import type { z } from 'zod';
import { Can } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';

type DishBody = z.output<typeof dishSchema>;
type OptionBody = z.output<typeof optionSchema>;

const connectIds = (ids: number[]) => ids.map((id) => ({ id }));

@Controller()
export class CatalogueController {
  constructor(private readonly db: PrismaService) {}

  // The reference lists share one shape, so they share these endpoints.
  private list(kind: ListKind) {
    const delegates = {
      allergens: this.db.allergen,
      'dietary-tags': this.db.dietaryTag,
      stations: this.db.station,
      'packaging-types': this.db.packagingType,
      'portion-sizes': this.db.portionSize,
    };
    // ponytail: the Prisma delegates have different generated types; this
    // narrows them to the few calls we make.
    return delegates[kind] as unknown as {
      findMany(args: object): Promise<{ id: number; name: string }[]>;
      findUnique(args: object): Promise<{ _count: Record<string, number> } | null>;
      create(args: object): Promise<{ id: number; name: string }>;
      delete(args: object): Promise<unknown>;
    };
  }

  @Get('lists')
  async lists(): Promise<Lists> {
    const entries = await Promise.all(
      LIST_KINDS.map(async (kind) => [
        kind,
        await this.list(kind).findMany({ orderBy: { name: 'asc' } }),
      ]),
    );
    return Object.fromEntries(entries);
  }

  @Post('lists/:kind')
  @Can('catalogue.manage')
  addListItem(
    @Param('kind', new ParseEnumPipe(LIST_KINDS)) kind: ListKind,
    @Body(new ZodPipe(listItemSchema)) { name }: { name: string },
  ) {
    return this.list(kind).create({ data: { name } });
  }

  // Refuse to delete anything still in use. For allergens and tags the
  // database would otherwise quietly untag every dish that had it.
  @Delete('lists/:kind/:id')
  @Can('catalogue.manage')
  async removeListItem(
    @Param('kind', new ParseEnumPipe(LIST_KINDS)) kind: ListKind,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const item = await this.list(kind).findUnique({ where: { id }, include: { _count: true } });
    if (!item) throw new NotFoundException({ message: 'Not found' });
    const uses = Object.values(item._count).reduce((sum, n) => sum + n, 0);
    if (uses > 0) {
      throw new ConflictException({
        message: `Still used in ${uses} place(s), so it can't be removed`,
      });
    }
    await this.list(kind).delete({ where: { id } });
    return { ok: true };
  }

  @Get('options')
  @Can('catalogue.view')
  options() {
    return this.db.option.findMany({
      orderBy: { name: 'asc' },
      include: {
        allergens: true,
        dietaryTags: true,
        sizes: { include: { size: true }, orderBy: { sizeId: 'asc' } },
      },
    });
  }

  @Post('options')
  @Can('catalogue.manage')
  createOption(@Body(new ZodPipe(optionSchema)) input: OptionBody) {
    const { sizes, ...data } = this.optionData(input);
    return this.db.option.create({ data: { ...data, sizes: { create: sizes } } });
  }

  @Put('options/:id')
  @Can('catalogue.manage')
  updateOption(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(optionSchema)) input: OptionBody,
  ) {
    const { sizes, ...data } = this.optionData(input);
    return this.db.$transaction(async (tx) => {
      // A group that sells this option in sizes needs every one of them (spec 4.1).
      const groups = await tx.optionGroup.findMany({
        where: { options: { some: { optionId: id } }, sizes: { some: {} } },
        include: { dish: true, sizes: { include: { size: true } } },
      });
      const kept = new Set(sizes.map((s) => s.sizeId));
      for (const group of groups) {
        const missing = group.sizes.find((s) => !kept.has(s.sizeId));
        if (missing) {
          throw new BadRequestException({
            message: `"${group.name}" on ${group.dish.name} sells it in ${missing.size.name}, so that size has to stay`,
            fieldErrors: { sizes: `Needed by ${group.dish.name}` },
          });
        }
      }
      await tx.optionSize.deleteMany({ where: { optionId: id } });
      return tx.option.update({
        where: { id },
        data: {
          ...data,
          allergens: { set: data.allergens.connect },
          dietaryTags: { set: data.dietaryTags.connect },
          sizes: { create: sizes },
        },
      });
    });
  }

  private optionData({ allergenIds, dietaryTagIds, sizes, ...fields }: OptionBody) {
    return {
      ...fields,
      allergens: { connect: connectIds(allergenIds) },
      dietaryTags: { connect: connectIds(dietaryTagIds) },
      sizes: sizes.map(({ sizeId, extraCharge }) => ({ sizeId, extraCharge })),
    };
  }

  @Get('dishes')
  @Can('catalogue.view')
  dishes() {
    return this.db.dish.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { station: true },
    });
  }

  // Shaped like the form, so the edit screen can load it straight in.
  @Get('dishes/:id')
  @Can('catalogue.view')
  async dish(@Param('id', ParseIntPipe) id: number) {
    const dish = await this.db.dish.findUnique({
      where: { id },
      include: {
        allergens: true,
        dietaryTags: true,
        optionGroups: {
          orderBy: { position: 'asc' },
          include: {
            options: { orderBy: { position: 'asc' } },
            sizes: { orderBy: { position: 'asc' } },
          },
        },
      },
    });
    if (!dish) throw new NotFoundException({ message: 'Dish not found' });
    const { allergens, dietaryTags, optionGroups, ...fields } = dish;
    return {
      ...fields,
      allergenIds: allergens.map((a) => a.id),
      dietaryTagIds: dietaryTags.map((t) => t.id),
      optionGroups: optionGroups.map((g) => ({
        name: g.name,
        required: g.required,
        maxChoices: g.maxChoices,
        optionIds: g.options.map((o) => o.optionId),
        sizeIds: g.sizes.map((s) => s.sizeId),
      })),
    };
  }

  @Post('dishes')
  @Can('catalogue.manage')
  createDish(@Body(new ZodPipe(dishSchema)) input: DishBody) {
    return this.saveDish(null, input);
  }

  @Put('dishes/:id')
  @Can('catalogue.manage')
  updateDish(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(dishSchema)) input: DishBody,
  ) {
    return this.saveDish(id, input);
  }

  // Option groups are replaced wholesale on save. Nothing points at a group's
  // id (orders keep a snapshot of the choices), so that's safe and simple.
  private async saveDish(
    id: number | null,
    { allergenIds, dietaryTagIds, optionGroups, ...fields }: DishBody,
  ) {
    await this.checkSizes(optionGroups);
    const groups = optionGroups.map((group, position) => ({
      name: group.name,
      required: group.required,
      maxChoices: group.maxChoices,
      position,
      options: { create: group.optionIds.map((optionId, i) => ({ optionId, position: i })) },
      sizes: { create: group.sizeIds.map((sizeId, i) => ({ sizeId, position: i })) },
    }));
    return this.db.$transaction(async (tx) => {
      if (id === null) {
        return tx.dish.create({
          data: {
            ...fields,
            allergens: { connect: connectIds(allergenIds) },
            dietaryTags: { connect: connectIds(dietaryTagIds) },
            optionGroups: { create: groups },
          },
        });
      }
      await tx.optionGroup.deleteMany({ where: { dishId: id } });
      return tx.dish.update({
        where: { id },
        data: {
          ...fields,
          allergens: { set: connectIds(allergenIds) },
          dietaryTags: { set: connectIds(dietaryTagIds) },
          optionGroups: { create: groups },
        },
      });
    });
  }

  // Portions (spec 4.1): a group either uses sizes or it doesn't, and if it
  // does, every option in it must come in every one of the group's sizes.
  private async checkSizes(groups: DishBody['optionGroups']) {
    const sized = groups.flatMap((g, i) => (g.sizeIds.length ? [{ ...g, i }] : []));
    if (sized.length === 0) return;
    const [options, sizes] = await Promise.all([
      this.db.option.findMany({
        where: { id: { in: sized.flatMap((g) => g.optionIds) } },
        include: { sizes: true },
      }),
      this.db.portionSize.findMany(),
    ]);
    for (const group of sized) {
      for (const optionId of group.optionIds) {
        const option = options.find((o) => o.id === optionId);
        const has = new Set(option?.sizes.map((s) => s.sizeId));
        const missing = group.sizeIds.find((sizeId) => !has.has(sizeId));
        if (option && missing !== undefined) {
          const size = sizes.find((s) => s.id === missing)?.name ?? 'that size';
          const message = `${option.name} doesn't come in ${size}. Add the size on the Options page, or take it off this group.`;
          throw new BadRequestException({
            message,
            fieldErrors: { [`optionGroups.${group.i}.sizeIds`]: message },
          });
        }
      }
    }
  }
}
