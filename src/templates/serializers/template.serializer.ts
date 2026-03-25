import { Expose, Type } from 'class-transformer';
import { BaseSerializer } from 'src/common/serializers';

class TemplatePhaseSerializer extends BaseSerializer {
  @Expose() title: string;
  @Expose() description: string;
  @Expose() order: number;
  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}

export class TemplateSerializer extends BaseSerializer {
  @Expose() organizationId: string;
  @Expose() name: string;
  @Expose() description: string;
  @Expose() isDefault: boolean;

  @Expose()
  @Type(() => TemplatePhaseSerializer)
  phases: TemplatePhaseSerializer[];

  @Expose() declare createdAt: Date;
  @Expose() declare updatedAt: Date;
}
