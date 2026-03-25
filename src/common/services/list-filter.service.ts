import { Injectable } from '@nestjs/common';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import {
  FindManyOptions,
  FindOptionsOrder,
  FindOptionsWhere,
  ILike,
  Repository,
} from 'typeorm';

import { ListFilterDTO } from '../dtos';
import { FilterResponse } from '../interfaces';

/**
 * Per-call parameters for list-filter operations.
 * Pass the repository and serializer at the call site so that this service
 * can be a singleton provider rather than being instantiated per-use.
 *
 * @typeParam T - The TypeORM entity type.
 * @typeParam S - The serializer / output type (inferred from `serializer`).
 */
interface Filters<T extends object, S> {
  filters: ListFilterDTO;
  options?: FindManyOptions<T>;
  searchFields?: string[];
  repository: Repository<T>;
  serializer: ClassConstructor<S>;
}

/**
 * Stateless pagination + search helper.  Injected via DI — one shared
 * instance per application context instead of `new ListFilterService(...)` at
 * every call site.
 */
@Injectable()
export class ListFilterService {
  async filter<T extends object, S>(
    params: Filters<T, S>,
  ): Promise<FilterResponse<S>> {
    const {
      filters,
      options: opts = {} as FindManyOptions<T>,
      searchFields = [],
      repository,
      serializer,
    } = params;
    const { page, limit, orderBy, sortOrder, search } = filters;

    if (orderBy) {
      const order = {} as FindOptionsOrder<T>;
      (order as Record<string, unknown>)[orderBy] = sortOrder;
      opts.order = order;
    }

    if (search) {
      const baseWhere = opts.where as Record<string, unknown> | undefined;

      const where = searchFields.map((field): FindOptionsWhere<T> => {
        const keys = field.split('.');
        const result: Record<string, unknown> = {};
        let current = result;

        keys.forEach((key, idx) => {
          if (idx === keys.length - 1) {
            current[key] = ILike(`%${search}%`);
          } else {
            current[key] = {};
            current = current[key] as Record<string, unknown>;
          }
        });

        return { ...baseWhere, ...result } as FindOptionsWhere<T>;
      });

      opts.where = where;
    }

    opts.skip = (page - 1) * limit;
    opts.take = limit;

    const [data, count] = await repository.findAndCount(opts);

    return {
      items: plainToInstance(serializer, data, {
        excludeExtraneousValues: true,
      }),
      count,
      pages: Math.ceil(count / limit),
      previousPage: page > 1 ? Number(page - 1) : null,
      page: Number(page),
      nextPage: count / limit > page ? Number(page) + 1 : null,
      limit: Number(limit),
    };
  }
}
