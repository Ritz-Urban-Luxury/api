export type ResponseObject<T> = {
  code?: string;

  message: string;

  data?: T;

  meta?: unknown;
};

export class Response {
  static json<T>(
    message: string,
    data?: T,
    meta?: unknown,
    code?: string,
  ): ResponseObject<T> {
    const responseObj: ResponseObject<T> = { message };
    if (data) {
      responseObj.data = data;
    }
    if (meta) {
      responseObj.meta = meta;
    }
    if (code) {
      responseObj.code = code;
    }

    return responseObj;
  }
}
