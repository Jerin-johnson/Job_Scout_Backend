import { UserRecord } from "../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { AuthenticatedUserPayload } from "../presentation/http/types/index.js";

declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: UserRecord | AuthenticatedUserPayload;
    }
  }
}

export {};
