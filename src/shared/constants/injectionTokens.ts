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

  // Use Cases - Jobs
  SearchJobsUseCase: Symbol.for("SearchJobsUseCase"),
  GetRecommendedJobsUseCase: Symbol.for("GetRecommendedJobsUseCase"),
  SaveJobUseCase: Symbol.for("SaveJobUseCase"),
  ManageSavedSearchesUseCase: Symbol.for("ManageSavedSearchesUseCase"),

  // Use Cases - Interviews
  CreateInterviewSessionUseCase: Symbol.for("CreateInterviewSessionUseCase"),
  SendInterviewMessageUseCase: Symbol.for("SendInterviewMessageUseCase"),
  CompleteInterviewUseCase: Symbol.for("CompleteInterviewUseCase"),

  // Use Cases - Memory
  RetrieveMemoriesUseCase: Symbol.for("RetrieveMemoriesUseCase"),
  ManageMemoryConsentUseCase: Symbol.for("ManageMemoryConsentUseCase"),

  // Testing
  TestService: Symbol.for("ITestService"),
} as const;

export type InjectionTokenKey = keyof typeof TOKENS;
