import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard, PermissionGuard } from 'src/auth/guards';
import { GetUser, RequirePermission } from 'src/auth/decorators';
import { User } from 'src/users/entities';
import { ListFilterDTO } from 'src/common/dtos';
import { LogActivity, ResponseMessage } from 'src/common/decorators';
import { CreateTemplateDto, UpdateTemplateDto } from './dtos';
import {
  TEMPLATE_CREATED,
  TEMPLATE_FETCHED,
  TEMPLATES_FETCHED,
  TEMPLATE_UPDATED,
} from './messages';
import { TemplatesService } from './templates.service';

@ApiTags('Templates')
@Controller('templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a template for the current organization' })
  @ApiResponse({ status: 201, description: 'Template created' })
  @ResponseMessage(TEMPLATE_CREATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('templateManagement', 'create')
  @LogActivity({ action: 'create:template', resource: 'template', includeBody: true })
  createTemplate(@Body() dto: CreateTemplateDto, @GetUser() user: User) {
    return this.templatesService.createTemplate(dto, user.organizationId);
  }

  @Get()
  @ApiOperation({ summary: 'List templates in the current organization' })
  @ApiResponse({ status: 200, description: 'Paginated list of templates' })
  @ResponseMessage(TEMPLATES_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('templateManagement', 'view')
  getTemplates(@Query() filters: ListFilterDTO, @GetUser() user: User) {
    return this.templatesService.getTemplates(filters, user.organizationId);
  }

  @Get(':identifier')
  @ApiOperation({ summary: 'Get a template by id or current frontend name identifier' })
  @ApiResponse({ status: 200, description: 'Template object with phases' })
  @ResponseMessage(TEMPLATE_FETCHED)
  @UseGuards(PermissionGuard)
  @RequirePermission('templateManagement', 'view')
  getTemplate(@Param('identifier') identifier: string, @GetUser() user: User) {
    return this.templatesService.getTemplateByIdentifier(identifier, user.organizationId);
  }

  @Patch(':identifier')
  @ApiOperation({ summary: 'Update a template by id or current frontend name identifier' })
  @ApiResponse({ status: 200, description: 'Template updated' })
  @ResponseMessage(TEMPLATE_UPDATED)
  @UseGuards(PermissionGuard)
  @RequirePermission('templateManagement', 'update')
  @LogActivity({ action: 'update:template', resource: 'template', includeBody: true })
  updateTemplate(
    @Param('identifier') identifier: string,
    @Body() dto: UpdateTemplateDto,
    @GetUser() user: User,
  ) {
    return this.templatesService.updateTemplateByIdentifier(
      identifier,
      dto,
      user.organizationId,
    );
  }
}
