import {
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

  // The four reference lists share one shape, so they share these endpoints.
  private list(kind: ListKind) {
    const delegates = {
      allergens: this.db.allergen,
      'dietary-tags': this.db.dietaryTag,
      stations: this.db.station,
      'packaging-types': this.db.packagingType,
    };
    // ponytail: the four Prisma delegates have different generated types; this
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
      include: { allergens: true, dietaryTags: true },
    });
  }

  @Post('options')
  @Can('catalogue.manage')
  createOption(@Body(new ZodPipe(optionSchema)) input: OptionBody) {
    return this.db.option.create({ data: this.optionData(input) });
  }

  @Put('options/:id')
  @Can('catalogue.manage')
  updateOption(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(optionSchema)) input: OptionBody,
  ) {
    const data = this.optionData(input);
    return this.db.option.update({
      where: { id },
      data: {
        ...data,
        allergens: { set: data.allergens.connect },
        dietaryTags: { set: data.dietaryTags.connect },
      },
    });
  }

  private optionData({ allergenIds, dietaryTagIds, ...fields }: OptionBody) {
    return {
      ...fields,
      allergens: { connect: connectIds(allergenIds) },
      dietaryTags: { connect: connectIds(dietaryTagIds) },
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
          include: { options: { orderBy: { position: 'asc' } } },
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
  private saveDish(
    id: number | null,
    { allergenIds, dietaryTagIds, optionGroups, ...fields }: DishBody,
  ) {
    const groups = optionGroups.map((group, position) => ({
      name: group.name,
      required: group.required,
      maxChoices: group.maxChoices,
      position,
      options: { create: group.optionIds.map((optionId, i) => ({ optionId, position: i })) },
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
}
