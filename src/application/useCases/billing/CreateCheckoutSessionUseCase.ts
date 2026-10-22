import { injectable, inject } from "tsyringe";
import { ICreateCheckoutSessionUseCase } from "../../interfaces/useCases/billing/ICreateCheckoutSessionUseCase.js";
import {
  IBillingGateway,
  CreateCheckoutParams,
  CheckoutSessionResult,
} from "../../../domain/services/IBillingGateway.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class CreateCheckoutSessionUseCase implements ICreateCheckoutSessionUseCase {
  constructor(@inject(TOKENS.BillingGateway) private readonly billingGateway: IBillingGateway) {}

  async execute(params: CreateCheckoutParams): Promise<CheckoutSessionResult> {
    return this.billingGateway.createCheckoutSession(params);
  }
}
