import { z } from "zod";
import { PLANS } from "../constants/plans.js";

export const checkoutSchema = z.object({
  plan: z.enum([PLANS.PRO, PLANS.PREMIUM]),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
