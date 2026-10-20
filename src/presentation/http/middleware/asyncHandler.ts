import { Request, Response, NextFunction, RequestHandler } from "express";

/**
 * Higher-order function that wraps async Express route handlers and controllers.
 * Catches any unhandled Promise rejections and forwards them to Express next(),
 * eliminating repetitive try/catch boilerplate across presentation controllers.
 */
export function asyncHandler<Req extends Request = Request, Res extends Response = Response>(
  fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => Promise<unknown> {
  return (req: Request, res: Response, next: NextFunction): Promise<unknown> => {
    return Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}
