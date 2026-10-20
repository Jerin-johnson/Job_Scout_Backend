import { ApplicationEntity } from "../entities/Application.js";
import { IBaseRepository } from "./IBaseRepository.js";

export interface IApplicationFilterOptions {
  stages?: string[];
  priority?: string;
  pinned?: boolean;
  followUp?: "overdue" | "due-soon";
  stale?: boolean;
  staleDays?: number;
  [key: string]: unknown;
}

export interface IApplicationRepository extends IBaseRepository<ApplicationEntity, string> {
  findOwnedById(id: string, userId: string): Promise<ApplicationEntity | null>;
  findByUserId(userId: string, filters?: IApplicationFilterOptions): Promise<ApplicationEntity[]>;
}
