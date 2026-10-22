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

export interface ApplicationBoardStats {
  totalActive: number;
  appliedThisWeek: number;
  interviews: number;
  offers: number;
  responseRate: number;
  followUpsDue: number;
}

export interface IApplicationRepository extends IBaseRepository<ApplicationEntity, string> {
  findOwnedById(id: string, userId: string): Promise<ApplicationEntity | null>;
  findByUserId(userId: string, filters?: IApplicationFilterOptions): Promise<ApplicationEntity[]>;
  getBoardStats(userId: string): Promise<ApplicationBoardStats>;
  findDuplicate(
    userId: string,
    params: { jobId?: string | null; companyName?: string; jobTitle?: string },
  ): Promise<ApplicationEntity | null>;
}
