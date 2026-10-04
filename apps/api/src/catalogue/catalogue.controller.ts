import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Post, Put } from '@nestjs/common';
import {
  dishSchema,
  LIST_KINDS,
  listItemSchema,
  optionSchema,
  type ListKind,
} from '@fernleaf/shared';
import { Can } from '../auth/auth.guard.js';
import { IdPipe } from '../id.pipe.js';
import { ZodPipe } from '../zod.pipe.js';
import { CatalogueService, type DishBody, type OptionBody } from './catalogue.service.js';

@Controller()
export class CatalogueController {
  constructor(private readonly catalogue: CatalogueService) {}

  // Read by the order, company and catalogue screens: every role but the driver.
  @Get('lists')
  @Can('orders.view')
  lists() {
    return this.catalogue.lists();
  }

  @Post('lists/:kind')
  @Can('catalogue.manage')
  addListItem(
    @Param('kind', new ParseEnumPipe(LIST_KINDS)) kind: ListKind,
    @Body(new ZodPipe(listItemSchema)) { name }: { name: string },
  ) {
    return this.catalogue.addListItem(kind, name);
  }

  @Delete('lists/:kind/:id')
  @Can('catalogue.manage')
  removeListItem(
    @Param('kind', new ParseEnumPipe(LIST_KINDS)) kind: ListKind,
    @Param('id', IdPipe) id: number,
  ) {
    return this.catalogue.removeListItem(kind, id);
  }

  @Get('options')
  @Can('catalogue.view')
  options() {
    return this.catalogue.options();
  }

  @Post('options')
  @Can('catalogue.manage')
  createOption(@Body(new ZodPipe(optionSchema)) input: OptionBody) {
    return this.catalogue.createOption(input);
  }

  @Put('options/:id')
  @Can('catalogue.manage')
  updateOption(
    @Param('id', IdPipe) id: number,
    @Body(new ZodPipe(optionSchema)) input: OptionBody,
  ) {
    return this.catalogue.updateOption(id, input);
  }

  @Get('dishes')
  @Can('catalogue.view')
  dishes() {
    return this.catalogue.dishes();
  }

  @Get('dishes/:id')
  @Can('catalogue.view')
  dish(@Param('id', IdPipe) id: number) {
    return this.catalogue.dish(id);
  }

  @Post('dishes')
  @Can('catalogue.manage')
  createDish(@Body(new ZodPipe(dishSchema)) input: DishBody) {
    return this.catalogue.saveDish(null, input);
  }

  @Put('dishes/:id')
  @Can('catalogue.manage')
  updateDish(@Param('id', IdPipe) id: number, @Body(new ZodPipe(dishSchema)) input: DishBody) {
    return this.catalogue.saveDish(id, input);
  }
}
