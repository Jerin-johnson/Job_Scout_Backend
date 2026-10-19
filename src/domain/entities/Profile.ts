import { IBaseEntity } from "../../shared/types/index.js";

export interface IRoleHistoryItem {
  title: string;
  company?: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
  skills?: string[];
}

export interface IPreferences {
  remoteOnly?: boolean;
  preferredLocations?: string[];
  targetRoles?: string[];
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  [key: string]: unknown;
}

export interface ProfileEntity extends IBaseEntity {
  userId: string;
  skills: string[];
  roles: IRoleHistoryItem[];
  preferences: IPreferences;
  careerProfile?: Record<string, unknown>;
  matchTokens?: string[];
  matchCountryCodes?: string[];
  version: number;
}
