import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

type PlainObject = Record<string, unknown>;

@Injectable()
export class TrimBodyPipe implements PipeTransform {
  private isObj(obj: unknown): obj is PlainObject {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
  }

  private trimValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.trimValue(item));
    }

    if (this.isObj(value)) {
      return this.trim(value);
    }

    if (typeof value === 'string') {
      return value.trim();
    }

    return value;
  }

  private trim(values: PlainObject): PlainObject {
    const output: PlainObject = {};

    for (const [key, val] of Object.entries(values)) {
      if (key === 'password') {
        output[key] = val;
        continue;
      }

      output[key] = this.trimValue(val);
    }

    return output;
  }

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const { type } = metadata;
    if (this.isObj(value) && type === 'body') {
      return this.trim(value);
    }
    return value;
  }
}
