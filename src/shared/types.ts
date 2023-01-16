import { Model as M, Document as D } from 'mongoose';
import { SoftDeleteModel, SoftDeleteDocument } from 'mongoose-delete';

export type Document = D & SoftDeleteDocument;

export type Model<T extends Document> = M<T> & SoftDeleteModel<T>;
