export interface IPasswordHasher {
  hash(password: string): Promise<string>;
  compare(plainText: string, hashed: string): Promise<boolean>;
}
