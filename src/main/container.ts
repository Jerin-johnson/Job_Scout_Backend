import "reflect-metadata";
import { container, injectable, inject } from "tsyringe";

export const TOKENS = {
  TestService: Symbol("ITestService"),
} as const;

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

export function setupTestContainer() {
  const child = container.createChildContainer();
  child.register<ITestService>(TOKENS.TestService, { useClass: MockTestService });
  return child;
}
