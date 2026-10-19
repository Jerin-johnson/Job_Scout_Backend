import { Request } from "express";

export interface AuthenticatedUserPayload {
  userId: string;
  role: string;
  plan: string;
  email?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserPayload;
}
