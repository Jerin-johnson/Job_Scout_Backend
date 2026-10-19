import { z } from "zod";
import { PLANS, ROLES } from "../constants/plans.js";

export const updateTrackedCompanySchema = z
  .object({ status: z.enum(["approved", "disabled"]) })
  .strict();
export type UpdateTrackedCompanyInput = z.infer<typeof updateTrackedCompanySchema>;

export const updateUserAdminSchema = z
  .object({
    plan: z.enum([PLANS.FREE, PLANS.PRO, PLANS.PREMIUM]).optional(),
    role: z.enum([ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN]).optional(),
  })
  .refine((value) => value.plan || value.role, "Provide a role or plan update");
export type UpdateUserAdminInput = z.infer<typeof updateUserAdminSchema>;

export const updateJobSourceSchema = z
  .object({ enabled: z.boolean().optional(), approved: z.boolean().optional() })
  .strict()
  .refine((value) => value.enabled !== undefined || value.approved !== undefined);
export type UpdateJobSourceInput = z.infer<typeof updateJobSourceSchema>;
