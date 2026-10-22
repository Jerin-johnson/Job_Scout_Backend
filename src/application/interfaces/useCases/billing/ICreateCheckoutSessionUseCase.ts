import {
  CreateCheckoutParams,
  CheckoutSessionResult,
} from "../../../../domain/services/IBillingGateway.js";

export interface ICreateCheckoutSessionUseCase {
  execute(params: CreateCheckoutParams): Promise<CheckoutSessionResult>;
}
