import { VerifyOtpInputDTO, VerifyOtpOutputDTO } from "../../../dtos/authDtos.js";

export interface IVerifyEmailOtpUseCase {
  execute(dto: VerifyOtpInputDTO): Promise<VerifyOtpOutputDTO>;
}
