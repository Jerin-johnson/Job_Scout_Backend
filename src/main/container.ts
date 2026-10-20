import "reflect-metadata";
import { container, DependencyContainer, injectable, inject, Lifecycle } from "tsyringe";
import { TOKENS } from "../shared/constants/injectionTokens.js";

// Domain Interfaces
import { IUserRepository } from "../domain/repositories/IUserRepository.js";
import { IProfileRepository } from "../domain/repositories/IProfileRepository.js";
import { IApplicationRepository } from "../domain/repositories/IApplicationRepository.js";
import { IPasswordHasher } from "../domain/security/IPasswordHasher.js";
import { ITokenService } from "../domain/security/ITokenService.js";
import { IStorageService } from "../domain/storage/IStorageService.js";
import { IEmailService } from "../domain/notifications/IEmailService.js";

// Infrastructure Implementations
import { MongooseUserRepository } from "../infrastructure/database/mongoose/repositories/MongooseUserRepository.js";
import { MongooseProfileRepository } from "../infrastructure/database/mongoose/repositories/MongooseProfileRepository.js";
import { MongooseApplicationRepository } from "../infrastructure/database/mongoose/repositories/MongooseApplicationRepository.js";
import { BcryptPasswordHasher } from "../infrastructure/security/BcryptPasswordHasher.js";
import { JwtTokenService } from "../infrastructure/security/JwtTokenService.js";
import { S3StorageService } from "../infrastructure/storage/S3StorageService.js";
import { ResendEmailService } from "../infrastructure/email/ResendEmailService.js";

// Application Use Cases
import { RegisterUserUseCase } from "../application/useCases/auth/RegisterUserUseCase.js";
import { LoginUserUseCase } from "../application/useCases/auth/LoginUserUseCase.js";
import { RefreshTokenUseCase } from "../application/useCases/auth/RefreshTokenUseCase.js";
import { GetApplicationsUseCase } from "../application/useCases/applications/GetApplicationsUseCase.js";
import { CreateApplicationUseCase } from "../application/useCases/applications/CreateApplicationUseCase.js";
import { UpdateApplicationStatusUseCase } from "../application/useCases/applications/UpdateApplicationStatusUseCase.js";
import { GetProfileUseCase } from "../application/useCases/profile/GetProfileUseCase.js";
import { UpsertProfileUseCase } from "../application/useCases/profile/UpsertProfileUseCase.js";

export { TOKENS };

export interface ITestService {
  execute(): string;
}

@injectable()
export class MockTestService implements ITestService {
  execute(): string {
    return "tsyringe_verified";
  }
}

@injectable()
export class TestConsumer {
  constructor(@inject(TOKENS.TestService) private readonly service: ITestService) {}

  run(): string {
    return this.service.execute();
  }
}

export function setupTestContainer(): DependencyContainer {
  const child = container.createChildContainer();
  child.register<ITestService>(TOKENS.TestService, { useClass: MockTestService });
  return child;
}

export function registerDependencies(targetContainer: DependencyContainer = container): DependencyContainer {
  // Repositories (Singletons)
  targetContainer.register<IUserRepository>(TOKENS.UserRepository, {
    useClass: MongooseUserRepository,
  }, { lifecycle: Lifecycle.Singleton });
  targetContainer.register<IProfileRepository>(TOKENS.ProfileRepository, {
    useClass: MongooseProfileRepository,
  }, { lifecycle: Lifecycle.Singleton });
  targetContainer.register<IApplicationRepository>(TOKENS.ApplicationRepository, {
    useClass: MongooseApplicationRepository,
  }, { lifecycle: Lifecycle.Singleton });

  // Security & Infrastructure Adapters (Singletons)
  targetContainer.register<IPasswordHasher>(TOKENS.PasswordHasher, {
    useClass: BcryptPasswordHasher,
  }, { lifecycle: Lifecycle.Singleton });
  targetContainer.register<ITokenService>(TOKENS.TokenService, {
    useClass: JwtTokenService,
  }, { lifecycle: Lifecycle.Singleton });
  targetContainer.register<IStorageService>(TOKENS.StorageService, {
    useClass: S3StorageService,
  }, { lifecycle: Lifecycle.Singleton });
  targetContainer.register<IEmailService>(TOKENS.EmailService, {
    useClass: ResendEmailService,
  }, { lifecycle: Lifecycle.Singleton });

  // Use Cases
  targetContainer.register<RegisterUserUseCase>(TOKENS.RegisterUserUseCase, {
    useClass: RegisterUserUseCase,
  });
  targetContainer.register<LoginUserUseCase>(TOKENS.LoginUserUseCase, {
    useClass: LoginUserUseCase,
  });
  targetContainer.register<RefreshTokenUseCase>(TOKENS.RefreshTokenUseCase, {
    useClass: RefreshTokenUseCase,
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

  return targetContainer;
}

export const appContainer = registerDependencies();
