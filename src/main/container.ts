import "reflect-metadata";
import { container, DependencyContainer, injectable, inject, Lifecycle } from "tsyringe";
import { TOKENS } from "../shared/constants/injectionTokens.js";

// Domain Interfaces
import { IUserRepository } from "../domain/repositories/IUserRepository.js";
import { IProfileRepository } from "../domain/repositories/IProfileRepository.js";
import { IApplicationRepository } from "../domain/repositories/IApplicationRepository.js";
import { IJobRepository } from "../domain/repositories/IJobRepository.js";
import { IFeedbackRepository } from "../domain/repositories/IFeedbackRepository.js";
import { ICatalogVersionRepository } from "../domain/repositories/ICatalogVersionRepository.js";
import { ISavedSearchRepository } from "../domain/repositories/ISavedSearchRepository.js";
import { IJobMatchReportRepository } from "../domain/repositories/IJobMatchReportRepository.js";
import { IAdminRepository } from "../domain/repositories/IAdminRepository.js";
import { IInteractionEventRepository } from "../domain/repositories/IInteractionEventRepository.js";
import { IFxRateRepository } from "../domain/repositories/IFxRateRepository.js";
import { IMatchRefreshRepository } from "../domain/repositories/IMatchRefreshRepository.js";
import { ITrackedCompanyRepository } from "../domain/repositories/ITrackedCompanyRepository.js";
import { IDocumentRepository } from "../domain/repositories/IDocumentRepository.js";
import { IPrivacyRepository } from "../domain/repositories/IPrivacyRepository.js";
import { IResumeRepository } from "../domain/repositories/IResumeRepository.js";
import { IInterviewSessionRepository } from "../domain/repositories/IInterviewSessionRepository.js";
import { IResumeMatchReportService } from "../domain/repositories/IResumeMatchReportService.js";
import { IPasswordHasher } from "../domain/security/IPasswordHasher.js";
import { ITokenService } from "../domain/security/ITokenService.js";
import { IOAuthService } from "../domain/security/IOAuthService.js";
import { IStorageService } from "../domain/storage/IStorageService.js";
import { IEmailService } from "../domain/notifications/IEmailService.js";
import { IBillingGateway } from "../domain/services/IBillingGateway.js";

// Infrastructure Implementations
import { MongooseUserRepository } from "../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { MongooseProfileRepository } from "../infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";
import { MongooseApplicationRepository } from "../infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { MongooseJobRepository } from "../infrastructure/database/mongoose/repositories/MongooseJobRepository.js";
import { MongooseFeedbackRepository } from "../infrastructure/database/mongoose/repositories/MongooseFeedbackRepository.js";
import { MongooseCatalogVersionRepository } from "../infrastructure/database/mongoose/repositories/MongooseCatalogVersionRepository.js";
import { MongooseSavedSearchRepository } from "../infrastructure/database/mongoose/repositories/MongooseSavedSearchRepository.js";
import { MongooseJobMatchReportRepository } from "../infrastructure/database/mongoose/repositories/MongooseJobMatchReportRepository.js";
import { MongooseAdminRepository } from "../infrastructure/database/mongoose/repositories/MongooseAdminRepository.js";
import { MongooseInteractionEventRepository } from "../infrastructure/database/mongoose/repositories/MongooseInteractionEventRepository.js";
import { MongooseFxRateRepository } from "../infrastructure/database/mongoose/repositories/MongooseFxRateRepository.js";
import { MongooseMatchRefreshRepository } from "../infrastructure/database/mongoose/repositories/MongooseMatchRefreshRepository.js";
import { MongooseTrackedCompanyRepository } from "../infrastructure/database/mongoose/repositories/MongooseTrackedCompanyRepository.js";
import { MongooseDocumentRepository } from "../infrastructure/database/mongoose/repositories/MongooseDocumentRepository.js";
import { MongoosePrivacyRepository } from "../infrastructure/privacy/MongoosePrivacyRepository.js";
import { MongooseResumeRepository } from "../infrastructure/storage/MongooseResumeRepository.js";
import { MongooseInterviewSessionRepository } from "../infrastructure/interview/interviewSessionService.js";
import { ConcreteResumeMatchReportService } from "../infrastructure/ai/services/resumeMatchReportService.js";
import { BcryptPasswordHasher } from "../infrastructure/security/BcryptPasswordHasher.js";
import { JwtTokenService } from "../infrastructure/security/JwtTokenService.js";
import { GoogleOAuthService } from "../infrastructure/security/GoogleOAuthService.js";
import { S3StorageService } from "../infrastructure/storage/S3StorageService.js";
import { ResendEmailService } from "../infrastructure/email/ResendEmailService.js";
import { BillingGatewayAdapter } from "../infrastructure/external-services/billing/BillingGatewayAdapter.js";

// Application Use Cases
import { RegisterUserUseCase } from "../application/useCases/auth/RegisterUserUseCase.js";
import { LoginUserUseCase } from "../application/useCases/auth/LoginUserUseCase.js";
import { GoogleLoginUseCase } from "../application/useCases/auth/GoogleLoginUseCase.js";
import { GetCurrentUserUseCase } from "../application/useCases/auth/GetCurrentUserUseCase.js";
import { RefreshTokenUseCase } from "../application/useCases/auth/RefreshTokenUseCase.js";
import { VerifyEmailOtpUseCase } from "../application/useCases/auth/VerifyEmailOtpUseCase.js";
import { ResendOtpUseCase } from "../application/useCases/auth/ResendOtpUseCase.js";
import { GetApplicationsUseCase } from "../application/useCases/applications/GetApplicationsUseCase.js";
import { CreateApplicationUseCase } from "../application/useCases/applications/CreateApplicationUseCase.js";
import { UpdateApplicationStatusUseCase } from "../application/useCases/applications/UpdateApplicationStatusUseCase.js";
import { GetProfileUseCase } from "../application/useCases/profile/GetProfileUseCase.js";
import { UpsertProfileUseCase } from "../application/useCases/profile/UpsertProfileUseCase.js";
import { SubmitFeedbackUseCase } from "../application/useCases/feedback/SubmitFeedbackUseCase.js";
import {
  ExportUserDataUseCase,
  DeleteUserAccountUseCase,
} from "../application/useCases/privacy/PrivacyUseCases.js";
import { DeleteResumeUseCase } from "../application/useCases/resumes/DeleteResumeUseCase.js";
import { ResumeMatchReportUseCase } from "../application/useCases/resumes/ResumeMatchReportUseCase.js";
import { InterviewSessionUseCase } from "../application/useCases/interviews/InterviewSessionUseCase.js";
import { CreateCheckoutSessionUseCase } from "../application/useCases/billing/CreateCheckoutSessionUseCase.js";
import { HandleRazorpayWebhookUseCase } from "../application/useCases/billing/HandleRazorpayWebhookUseCase.js";

export { TOKENS };

export interface ITestService {
  execute(): string;
}

@injectable()
export class MockTestService implements ITestService {
  execute(): string {
    return "mocked";
  }
}

@injectable()
export class ClientComponent {
  constructor(@inject(TOKENS.TestService) private readonly service: ITestService) {}
  getVal(): string {
    return this.service.execute();
  }
}

export function registerDependencies(
  targetContainer: DependencyContainer = container,
): DependencyContainer {
  const child = targetContainer.createChildContainer();
  child.register<ITestService>(TOKENS.TestService, { useClass: MockTestService });

  // Repositories
  targetContainer.register<IUserRepository>(
    TOKENS.UserRepository,
    {
      useClass: MongooseUserRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IProfileRepository>(
    TOKENS.ProfileRepository,
    {
      useClass: MongooseProfileRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IApplicationRepository>(
    TOKENS.ApplicationRepository,
    {
      useClass: MongooseApplicationRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IJobRepository>(
    TOKENS.JobRepository,
    {
      useClass: MongooseJobRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IFeedbackRepository>(
    TOKENS.FeedbackRepository,
    {
      useClass: MongooseFeedbackRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<ICatalogVersionRepository>(
    TOKENS.CatalogVersionRepository,
    {
      useClass: MongooseCatalogVersionRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<ISavedSearchRepository>(
    TOKENS.SavedSearchRepository,
    {
      useClass: MongooseSavedSearchRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IJobMatchReportRepository>(
    TOKENS.JobMatchReportRepository,
    {
      useClass: MongooseJobMatchReportRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IAdminRepository>(
    TOKENS.AdminRepository,
    {
      useClass: MongooseAdminRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IInteractionEventRepository>(
    TOKENS.InteractionEventRepository,
    {
      useClass: MongooseInteractionEventRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IFxRateRepository>(
    TOKENS.FxRateRepository,
    {
      useClass: MongooseFxRateRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IMatchRefreshRepository>(
    TOKENS.MatchRefreshRepository,
    {
      useClass: MongooseMatchRefreshRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<ITrackedCompanyRepository>(
    TOKENS.TrackedCompanyRepository,
    {
      useClass: MongooseTrackedCompanyRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IDocumentRepository>(
    TOKENS.DocumentRepository,
    {
      useClass: MongooseDocumentRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IPrivacyRepository>(
    TOKENS.PrivacyRepository,
    {
      useClass: MongoosePrivacyRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IResumeRepository>(
    TOKENS.ResumeRepository,
    {
      useClass: MongooseResumeRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IInterviewSessionRepository>(
    TOKENS.InterviewSessionRepository,
    {
      useClass: MongooseInterviewSessionRepository,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IResumeMatchReportService>(
    TOKENS.ResumeMatchReportService,
    {
      useClass: ConcreteResumeMatchReportService,
    },
    { lifecycle: Lifecycle.Singleton },
  );

  // Security & Storage & Notifications & External Services
  targetContainer.register<IPasswordHasher>(
    TOKENS.PasswordHasher,
    {
      useClass: BcryptPasswordHasher,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<ITokenService>(
    TOKENS.TokenService,
    {
      useClass: JwtTokenService,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IOAuthService>(
    TOKENS.OAuthService,
    {
      useClass: GoogleOAuthService,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IStorageService>(
    TOKENS.StorageService,
    {
      useClass: S3StorageService,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IEmailService>(
    TOKENS.EmailService,
    {
      useClass: ResendEmailService,
    },
    { lifecycle: Lifecycle.Singleton },
  );
  targetContainer.register<IBillingGateway>(
    TOKENS.BillingGateway,
    {
      useClass: BillingGatewayAdapter,
    },
    { lifecycle: Lifecycle.Singleton },
  );

  // Use Cases
  targetContainer.register<RegisterUserUseCase>(TOKENS.RegisterUserUseCase, {
    useClass: RegisterUserUseCase,
  });
  targetContainer.register<LoginUserUseCase>(TOKENS.LoginUserUseCase, {
    useClass: LoginUserUseCase,
  });
  targetContainer.register<GoogleLoginUseCase>(TOKENS.GoogleLoginUseCase, {
    useClass: GoogleLoginUseCase,
  });
  targetContainer.register<GetCurrentUserUseCase>(TOKENS.GetCurrentUserUseCase, {
    useClass: GetCurrentUserUseCase,
  });
  targetContainer.register<RefreshTokenUseCase>(TOKENS.RefreshTokenUseCase, {
    useClass: RefreshTokenUseCase,
  });
  targetContainer.register<VerifyEmailOtpUseCase>(TOKENS.VerifyEmailOtpUseCase, {
    useClass: VerifyEmailOtpUseCase,
  });
  targetContainer.register<ResendOtpUseCase>(TOKENS.ResendOtpUseCase, {
    useClass: ResendOtpUseCase,
  });
  targetContainer.register<GetApplicationsUseCase>(TOKENS.GetApplicationsUseCase, {
    useClass: GetApplicationsUseCase,
  });
  targetContainer.register<CreateApplicationUseCase>(TOKENS.CreateApplicationUseCase, {
    useClass: CreateApplicationUseCase,
  });
  targetContainer.register<UpdateApplicationStatusUseCase>(TOKENS.UpdateApplicationStatusUseCase, {
    useClass: UpdateApplicationStatusUseCase,
  });
  targetContainer.register<GetProfileUseCase>(TOKENS.GetProfileUseCase, {
    useClass: GetProfileUseCase,
  });
  targetContainer.register<UpsertProfileUseCase>(TOKENS.UpsertProfileUseCase, {
    useClass: UpsertProfileUseCase,
  });
  targetContainer.register<SubmitFeedbackUseCase>(TOKENS.SubmitFeedbackUseCase, {
    useClass: SubmitFeedbackUseCase,
  });
  targetContainer.register<ExportUserDataUseCase>(TOKENS.ExportUserDataUseCase, {
    useClass: ExportUserDataUseCase,
  });
  targetContainer.register<DeleteUserAccountUseCase>(TOKENS.DeleteUserAccountUseCase, {
    useClass: DeleteUserAccountUseCase,
  });
  targetContainer.register<DeleteResumeUseCase>(TOKENS.DeleteResumeUseCase, {
    useClass: DeleteResumeUseCase,
  });
  targetContainer.register<ResumeMatchReportUseCase>(TOKENS.ResumeMatchReportUseCase, {
    useClass: ResumeMatchReportUseCase,
  });
  targetContainer.register<InterviewSessionUseCase>(TOKENS.InterviewSessionUseCase, {
    useClass: InterviewSessionUseCase,
  });
  targetContainer.register<CreateCheckoutSessionUseCase>(TOKENS.CreateCheckoutSessionUseCase, {
    useClass: CreateCheckoutSessionUseCase,
  });
  targetContainer.register<HandleRazorpayWebhookUseCase>(TOKENS.HandleRazorpayWebhookUseCase, {
    useClass: HandleRazorpayWebhookUseCase,
  });

  return targetContainer;
}

export const appContainer = registerDependencies();
