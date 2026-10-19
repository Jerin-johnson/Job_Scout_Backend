import { UserRecord } from "../repositories/userRepository.js";
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
