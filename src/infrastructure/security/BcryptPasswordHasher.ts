import bcrypt from "bcryptjs";
import { injectable } from "tsyringe";
import { IPasswordHasher } from "../../domain/security/IPasswordHasher.js";

@injectable()
export class BcryptPasswordHasher implements IPasswordHasher {
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, 12);
  }

  async compare(plainText: string, hashed: string): Promise<boolean> {
    return bcrypt.compare(plainText, hashed);
  }
}
