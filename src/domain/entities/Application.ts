import { IBaseEntity } from "../../shared/types/index.js";

export interface IApplicationContact {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export interface IApplicationActivity {
  action: string;
  notes?: string;
  date: Date;
}

export interface ApplicationEntity extends IBaseEntity {
  userId: string;
  jobId?: string | null;
  companyName: string;
  jobTitle: string;
  status: string;
  priority: string;
  appliedDate: Date;
  location?: string;
  source?: string;
  salaryMin?: number | null;
  salaryMax?: number | null;
  notes?: string;
  contacts: IApplicationContact[];
  activityLog: IApplicationActivity[];
  pinnedAt?: Date | null;
  archivedAt?: Date | null;
  archiveReason?: string;
  nextFollowUpAt?: Date | null;
  lastActivityAt?: Date | null;
}
