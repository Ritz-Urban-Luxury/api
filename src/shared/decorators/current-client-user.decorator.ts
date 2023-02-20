import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentClientUser = createParamDecorator(
  (data: unknown, context: ExecutionContext) => {
    const client = context.switchToWs().getClient();

    return client.user;
  },
);
