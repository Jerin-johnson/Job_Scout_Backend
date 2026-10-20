export interface IBaseRepository<T, TId = string> {
  findById(id: TId): Promise<T | null>;
  create(item: Partial<T>): Promise<T>;
  update(id: TId, updates: Partial<T>): Promise<T | null>;
  delete(id: TId): Promise<boolean>;
}
