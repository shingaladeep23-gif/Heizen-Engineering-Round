import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  categorySchema,
  menuItemSchema,
  reorderSchema,
  toggleSchema,
  type CategoryInput,
} from '@fernleaf/shared';
import { Can } from '../auth/auth.guard.js';
import { PrismaService } from '../prisma.service.js';
import { ZodPipe } from '../zod.pipe.js';
import { MenuService } from './menu.service.js';

@Controller('menu')
export class MenuController {
  constructor(
    private readonly db: PrismaService,
    private readonly menu: MenuService,
  ) {}

  @Get('categories')
  @Can('catalogue.view')
  categories() {
    return this.db.menuCategory.findMany({
      orderBy: { position: 'asc' },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: { dish: { select: { name: true, active: true } } },
        },
      },
    });
  }

  @Post('categories')
  @Can('catalogue.manage')
  async createCategory(@Body(new ZodPipe(categorySchema)) input: Required<CategoryInput>) {
    const last = await this.db.menuCategory.aggregate({ _max: { position: true } });
    return this.db.menuCategory.create({
      data: { ...input, position: (last._max.position ?? -1) + 1 },
    });
  }

  @Put('categories/order')
  @Can('catalogue.manage')
  async orderCategories(@Body(new ZodPipe(reorderSchema)) { ids }: { ids: number[] }) {
    await this.db.$transaction(
      ids.map((id, position) => this.db.menuCategory.update({ where: { id }, data: { position } })),
    );
    return { ok: true };
  }

  @Put('categories/:id')
  @Can('catalogue.manage')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(categorySchema)) input: Required<CategoryInput>,
  ) {
    return this.db.menuCategory.update({ where: { id }, data: input });
  }

  @Post('categories/:id/items')
  @Can('catalogue.manage')
  async addItem(
    @Param('id', ParseIntPipe) categoryId: number,
    @Body(new ZodPipe(menuItemSchema)) { dishId }: { dishId: number },
  ) {
    const last = await this.db.menuItem.aggregate({
      where: { categoryId },
      _max: { position: true },
    });
    return this.db.menuItem.create({
      data: { categoryId, dishId, position: (last._max.position ?? -1) + 1 },
    });
  }

  @Put('categories/:id/items/order')
  @Can('catalogue.manage')
  async orderItems(
    @Param('id', ParseIntPipe) categoryId: number,
    @Body(new ZodPipe(reorderSchema)) { ids }: { ids: number[] },
  ) {
    await this.db.$transaction(
      ids.map((id, position) =>
        this.db.menuItem.update({ where: { id, categoryId }, data: { position } }),
      ),
    );
    return { ok: true };
  }

  @Put('items/:id')
  @Can('catalogue.manage')
  toggleItem(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodPipe(toggleSchema)) { active }: { active: boolean },
  ) {
    return this.db.menuItem.update({ where: { id }, data: { active } });
  }

  // Taking a dish off a category is just removing a placement; the dish and
  // its history are untouched.
  @Delete('items/:id')
  @Can('catalogue.manage')
  async removeItem(@Param('id', ParseIntPipe) id: number) {
    await this.db.menuItem.delete({ where: { id } });
    return { ok: true };
  }

  @Get('preview')
  @Can('companies.view')
  preview(
    @Query('employeeId', ParseIntPipe) employeeId: number,
    @Query('categoryId', new ParseIntPipe({ optional: true })) categoryId?: number,
    @Query('allSecret') allSecret?: string,
  ) {
    return this.menu.menuFor(employeeId, { openId: categoryId, all: allSecret === 'true' });
  }
}
