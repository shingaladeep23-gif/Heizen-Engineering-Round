import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  categorySchema,
  menuItemSchema,
  reorderSchema,
  toggleSchema,
  type CategoryInput,
} from '@fernleaf/shared';
import { Can } from '../auth/auth.guard.js';
import { IdPipe } from '../id.pipe.js';
import { ZodPipe } from '../zod.pipe.js';
import { MenuService } from './menu.service.js';

@Controller('menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('categories')
  @Can('catalogue.view')
  categories() {
    return this.menu.categories();
  }

  @Post('categories')
  @Can('catalogue.manage')
  createCategory(@Body(new ZodPipe(categorySchema)) input: Required<CategoryInput>) {
    return this.menu.createCategory(input);
  }

  @Put('categories/order')
  @Can('catalogue.manage')
  orderCategories(@Body(new ZodPipe(reorderSchema)) { ids }: { ids: number[] }) {
    return this.menu.orderCategories(ids);
  }

  @Put('categories/:id')
  @Can('catalogue.manage')
  updateCategory(
    @Param('id', IdPipe) id: number,
    @Body(new ZodPipe(categorySchema)) input: Required<CategoryInput>,
  ) {
    return this.menu.updateCategory(id, input);
  }

  @Post('categories/:id/items')
  @Can('catalogue.manage')
  addItem(
    @Param('id', IdPipe) categoryId: number,
    @Body(new ZodPipe(menuItemSchema)) { dishId }: { dishId: number },
  ) {
    return this.menu.addItem(categoryId, dishId);
  }

  @Put('categories/:id/items/order')
  @Can('catalogue.manage')
  orderItems(
    @Param('id', IdPipe) categoryId: number,
    @Body(new ZodPipe(reorderSchema)) { ids }: { ids: number[] },
  ) {
    return this.menu.orderItems(categoryId, ids);
  }

  @Put('items/:id')
  @Can('catalogue.manage')
  toggleItem(
    @Param('id', IdPipe) id: number,
    @Body(new ZodPipe(toggleSchema)) { active }: { active: boolean },
  ) {
    return this.menu.toggleItem(id, active);
  }

  @Delete('items/:id')
  @Can('catalogue.manage')
  removeItem(@Param('id', IdPipe) id: number) {
    return this.menu.removeItem(id);
  }

  @Get('preview')
  @Can('companies.view')
  preview(
    @Query('employeeId', IdPipe) employeeId: number,
    @Query('categoryId', IdPipe) categoryId?: number,
    @Query('allSecret') allSecret?: string,
  ) {
    return this.menu.menuFor(employeeId, { openId: categoryId, all: allSecret === 'true' });
  }
}
