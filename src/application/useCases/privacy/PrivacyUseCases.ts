import { injectable, inject } from "tsyringe";
import { IExportUserDataUseCase } from "../../interfaces/useCases/privacy/IExportUserDataUseCase.js";
import { IDeleteUserAccountUseCase } from "../../interfaces/useCases/privacy/IDeleteUserAccountUseCase.js";
import { IPrivacyRepository } from "../../../domain/repositories/IPrivacyRepository.js";
import { TOKENS } from "../../../shared/constants/injectionTokens.js";

@injectable()
export class ExportUserDataUseCase implements IExportUserDataUseCase {
  constructor(
    @inject(TOKENS.PrivacyRepository)
    private readonly privacyRepository: IPrivacyRepository,
  ) {}

  async execute(userId: string): Promise<Record<string, unknown>> {
    return this.privacyRepository.exportUserData(userId);
  }
}

@injectable()
export class DeleteUserAccountUseCase implements IDeleteUserAccountUseCase {
  constructor(
    @inject(TOKENS.PrivacyRepository)
    private readonly privacyRepository: IPrivacyRepository,
  ) {}

  async execute(userId: string): Promise<{ message: string; deletedAt: string }> {
    return this.privacyRepository.deleteUserAccount(userId);
  }
}
