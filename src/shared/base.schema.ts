import { applyDecorators } from '@nestjs/common';
import { Schema as S, SchemaOptions } from '@nestjs/mongoose';
import { Document } from './types';

export class BaseSchema {
  id?: string;

  updatedAt?: Date;

  createdAt?: Date;

  deleted?: boolean;
}

export const Schema = (options?: SchemaOptions) =>
  applyDecorators(
    S({
      timestamps: true,
      toJSON: {
        virtuals: true,
        transform: (_doc: unknown, ret: Document): void => {
          delete ret._id;
          delete ret.__v;
        },
      },
      toObject: {
        virtuals: true,
      },
      ...options,
    }),
  );

export const EmbeddedSchema = (options?: SchemaOptions) =>
  applyDecorators(
    Schema({
      _id: false,
      timestamps: false,
      toJSON: {
        virtuals: true,
        transform(_doc: unknown, ret): void {
          delete ret.deleted;
        },
      },
      ...options,
    }),
  );
