import { Request } from "express";

export interface AuthenticatedUserPayload {
  _id?: string;
  userId: string;
  role: string;
  plan: string;
  email?: string;
  familyId?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUserPayload;
}
