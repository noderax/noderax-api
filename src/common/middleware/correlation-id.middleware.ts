import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const id = req.headers[CORRELATION_ID_HEADER.toLowerCase()] || randomUUID();
    req.headers[CORRELATION_ID_HEADER.toLowerCase()] = id;
    res.setHeader(CORRELATION_ID_HEADER, id);
    next();
  }
}
