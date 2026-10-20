/**
 * Centralized Dependency Injection Tokens for TSyringe.
 * Symbols ensure collision-free, type-safe token resolution across Clean Architecture layers.
 */
export const TOKENS = {
  // Domain Repositories
  UserRepository: Symbol.for("IUserRepository"),
  ProfileRepository: Symbol.for("IProfileRepository"),
  ResumeRepository: Symbol.for("IResumeRepository"),
  JobRepository: Symbol.for("IJobRepository"),
  ApplicationRepository: Symbol.for("IApplicationRepository"),
  InterviewRepository: Symbol.for("IInterviewRepository"),
  MemoryRepository: Symbol.for("IMemoryRepository"),
  ChatSessionRepository: Symbol.for("IChatSessionRepository"),
  AuditLogRepository: Symbol.for("IAuditLogRepository"),
  FeedbackRepository: Symbol.for("IFeedbackRepository"),
  CatalogVersionRepository: Symbol.for("ICatalogVersionRepository"),
  SavedSearchRepository: Symbol.for("ISavedSearchRepository"),
  JobMatchReportRepository: Symbol.for("IJobMatchReportRepository"),
  AdminRepository: Symbol.for("IAdminRepository"),
  InteractionEventRepository: Symbol.for("IInteractionEventRepository"),
  FxRateRepository: Symbol.for("IFxRateRepository"),
  UsageEventRepository: Symbol.for("IUsageEventRepository"),
  MatchRefreshRepository: Symbol.for("IMatchRefreshRepository"),
  TrackedCompanyRepository: Symbol.for("ITrackedCompanyRepository"),
  DocumentRepository: Symbol.for("IDocumentRepository"),
  PrivacyRepository: Symbol.for("IPrivacyRepository"),
  InterviewSessionRepository: Symbol.for("IInterviewSessionRepository"),
  ResumeMatchReportService: Symbol.for("IResumeMatchReportService"),

  // Infrastructure & Adapters
  PasswordHasher: Symbol.for("IPasswordHasher"),
  TokenService: Symbol.for("ITokenService"),
  StorageService: Symbol.for("IStorageService"),
  EmailService: Symbol.for("IEmailService"),
  CacheService: Symbol.for("ICacheService"),

  // Use Cases - Auth
  RegisterUserUseCase: Symbol.for("RegisterUserUseCase"),
  LoginUserUseCase: Symbol.for("LoginUserUseCase"),
  GoogleLoginUseCase: Symbol.for("GoogleLoginUseCase"),
  RefreshTokenUseCase: Symbol.for("RefreshTokenUseCase"),
  VerifyEmailOtpUseCase: Symbol.for("VerifyEmailOtpUseCase"),
  ResendOtpUseCase: Symbol.for("ResendOtpUseCase"),

  // Use Cases - Applications
  GetApplicationsUseCase: Symbol.for("GetApplicationsUseCase"),
  CreateApplicationUseCase: Symbol.for("CreateApplicationUseCase"),
  UpdateApplicationUseCase: Symbol.for("UpdateApplicationUseCase"),
  UpdateApplicationStatusUseCase: Symbol.for("UpdateApplicationStatusUseCase"),
  ScheduleFollowUpUseCase: Symbol.for("ScheduleFollowUpUseCase"),

  // Use Cases - Profile & Resume
  GetProfileUseCase: Symbol.for("GetProfileUseCase"),
  UpsertProfileUseCase: Symbol.for("UpsertProfileUseCase"),
  PresignResumeUploadUseCase: Symbol.for("PresignResumeUploadUseCase"),
  CompleteResumeUploadUseCase: Symbol.for("CompleteResumeUploadUseCase"),
  ResumeMatchReportUseCase: Symbol.for("ResumeMatchReportUseCase"),
  DeleteResumeUseCase: Symbol.for("DeleteResumeUseCase"),

  // Use Cases - Jobs
  SearchJobsUseCase: Symbol.for("SearchJobsUseCase"),
  GetRecommendedJobsUseCase: Symbol.for("GetRecommendedJobsUseCase"),
  SaveJobUseCase: Symbol.for("SaveJobUseCase"),
  ManageSavedSearchesUseCase: Symbol.for("ManageSavedSearchesUseCase"),

  // Use Cases - Interviews
  CreateInterviewSessionUseCase: Symbol.for("CreateInterviewSessionUseCase"),
  SendInterviewMessageUseCase: Symbol.for("SendInterviewMessageUseCase"),
  CompleteInterviewUseCase: Symbol.for("CompleteInterviewUseCase"),
  InterviewSessionUseCase: Symbol.for("InterviewSessionUseCase"),

  // Use Cases - Memory
  RetrieveMemoriesUseCase: Symbol.for("RetrieveMemoriesUseCase"),
  ManageMemoryConsentUseCase: Symbol.for("ManageMemoryConsentUseCase"),

  // Use Cases - Feedback & Privacy
  SubmitFeedbackUseCase: Symbol.for("SubmitFeedbackUseCase"),
  ExportUserDataUseCase: Symbol.for("ExportUserDataUseCase"),
  DeleteUserAccountUseCase: Symbol.for("DeleteUserAccountUseCase"),

  // Testing
  TestService: Symbol.for("ITestService"),
} as const;

export type InjectionTokenKey = keyof typeof TOKENS;
