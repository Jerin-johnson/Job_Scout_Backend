import { ResendOtpInputDTO, ResendOtpOutputDTO } from "../../../dtos/authDtos.js";

export interface IResendOtpUseCase {
  execute(dto: ResendOtpInputDTO): Promise<ResendOtpOutputDTO>;
}
