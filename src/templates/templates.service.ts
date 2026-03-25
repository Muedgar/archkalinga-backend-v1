import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { FindManyOptions, Repository } from 'typeorm';
import { ListFilterDTO } from 'src/common/dtos';
import { FilterResponse } from 'src/common/interfaces';
import { ListFilterService } from 'src/common/services';
import { Organization } from 'src/organizations/entities/organization.entity';
import { CreateTemplateDto, UpdateTemplateDto } from './dtos';
import { TEMPLATE_EXISTS, TEMPLATE_NOT_FOUND } from './messages';
import { Template, TemplatePhase } from './entities';
import { TemplateSerializer } from './serializers';

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(Template)
    private readonly templateRepo: Repository<Template>,
    @InjectRepository(TemplatePhase)
    private readonly templatePhaseRepo: Repository<TemplatePhase>,
    @InjectRepository(Organization)
    private readonly orgRepo: Repository<Organization>,
    private readonly listFilterService: ListFilterService,
  ) {}

  private normalizeName(name: string): string {
    return name.trim();
  }

  private withRelations(): FindManyOptions<Template> {
    return {
      relations: ['phases'],
      order: {
        createdAt: 'DESC',
        phases: { order: 'ASC' },
      },
    };
  }

  private async ensureNameFree(
    name: string,
    organizationId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.templateRepo.findOne({
      where: { name, organizationId },
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(TEMPLATE_EXISTS);
    }
  }

  private async clearDefaultForOrganization(organizationId: string): Promise<void> {
    await this.templateRepo.update(
      { organizationId, isDefault: true },
      { isDefault: false },
    );
  }

  private async loadOne(where: {
    id?: string;
    name?: string;
    organizationId: string;
  }): Promise<Template> {
    const template = await this.templateRepo.findOne({
      where,
      relations: ['phases'],
      order: { phases: { order: 'ASC' } },
    });
    if (!template) throw new NotFoundException(TEMPLATE_NOT_FOUND);
    return template;
  }

  private toSerializer(template: Template): TemplateSerializer {
    return plainToInstance(TemplateSerializer, template, {
      excludeExtraneousValues: true,
    });
  }

  private buildPhaseEntities(
    phases: CreateTemplateDto['phases'],
    template: Template,
  ): TemplatePhase[] {
    return phases.map((phase, index) =>
      this.templatePhaseRepo.create({
        title: phase.title.trim(),
        description: phase.description.trim(),
        order: index + 1,
        template,
        templateId: template.id,
      }),
    );
  }

  async createTemplate(
    dto: CreateTemplateDto,
    organizationId: string,
  ): Promise<TemplateSerializer> {
    const name = this.normalizeName(dto.name);
    await this.ensureNameFree(name, organizationId);

    // Load the org record before the transaction so we can set the relation
    // object alongside the scalar UUID — TypeORM resolves organization_id (int FK)
    // from the entity relation, not from the organizationId UUID column.
    const orgRecord = await this.orgRepo.findOneOrFail({ where: { id: organizationId } });

    const saved = await this.templateRepo.manager.transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.update(Template, { organizationId, isDefault: true }, { isDefault: false });
      }

      const template = tx.create(Template, {
        organization: orgRecord,
        organizationId,
        name,
        description: dto.description.trim(),
        isDefault: dto.isDefault,
      });

      const savedTemplate = await tx.save(template);
      const phases = dto.phases.map((phase, index) =>
        tx.create(TemplatePhase, {
          title: phase.title.trim(),
          description: phase.description.trim(),
          order: index + 1,
          template: savedTemplate,
          templateId: savedTemplate.id,
        }),
      );
      await tx.save(phases);
      return savedTemplate;
    });

    return this.toSerializer(await this.loadOne({ id: saved.id, organizationId }));
  }

  async getTemplates(
    filters: ListFilterDTO,
    organizationId: string,
  ): Promise<FilterResponse<TemplateSerializer>> {
    return this.listFilterService.filter({
      repository: this.templateRepo,
      serializer: TemplateSerializer,
      filters,
      searchFields: ['name', 'description'],
      options: {
        ...this.withRelations(),
        where: { organizationId },
      } as FindManyOptions<Template>,
    });
  }

  async getTemplateByIdentifier(
    identifier: string,
    organizationId: string,
  ): Promise<TemplateSerializer> {
    const template = await this.findTemplateByIdentifier(identifier, organizationId);
    return this.toSerializer(template);
  }

  async updateTemplateByIdentifier(
    identifier: string,
    dto: UpdateTemplateDto,
    organizationId: string,
  ): Promise<TemplateSerializer> {
    const template = await this.findTemplateByIdentifier(identifier, organizationId);

    if (dto.name !== undefined) {
      const name = this.normalizeName(dto.name);
      await this.ensureNameFree(name, organizationId, template.id);
      template.name = name;
    }

    if (dto.description !== undefined) {
      template.description = dto.description.trim();
    }

    const shouldReplacePhases = dto.phases !== undefined;
    const shouldBecomeDefault = dto.isDefault === true;
    const shouldUnsetDefault = dto.isDefault === false;

    const updated = await this.templateRepo.manager.transaction(async (tx) => {
      if (shouldBecomeDefault) {
        await tx.update(Template, { organizationId, isDefault: true }, { isDefault: false });
        template.isDefault = true;
      } else if (shouldUnsetDefault) {
        template.isDefault = false;
      }

      await tx.save(template);

      if (shouldReplacePhases) {
        await tx.delete(TemplatePhase, { templateId: template.id });

        if (dto.phases && dto.phases.length > 0) {
          const phases = dto.phases.map((phase, index) =>
            tx.create(TemplatePhase, {
              title: phase.title.trim(),
              description: phase.description.trim(),
              order: index + 1,
              template,
              templateId: template.id,
            }),
          );
          await tx.save(phases);
        }
      }

      return template;
    });

    return this.toSerializer(await this.loadOne({ id: updated.id, organizationId }));
  }

  private async findTemplateByIdentifier(
    identifier: string,
    organizationId: string,
  ): Promise<Template> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        identifier,
      );

    if (isUuid) {
      const byId = await this.templateRepo.findOne({
        where: { id: identifier, organizationId },
        relations: ['phases'],
        order: { phases: { order: 'ASC' } },
      });
      if (byId) return byId;
    }

    const byName = await this.templateRepo.findOne({
      where: { name: identifier, organizationId },
      relations: ['phases'],
      order: { phases: { order: 'ASC' } },
    });
    if (!byName) throw new NotFoundException(TEMPLATE_NOT_FOUND);
    return byName;
  }
}
