import { z } from "zod";

export const registerInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one digit"),
  name: z.string().min(1, "Name is required").max(100),
});

export type RegisterUserInputDTO = z.infer<typeof registerInputSchema>;

export interface AuthUserDTO {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  isEmailVerified?: boolean;
}

export interface AuthTokensDTO {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterUserOutputDTO {
  user: AuthUserDTO;
  requiresVerification: boolean;
  message: string;
  tokens?: AuthTokensDTO;
}

export const loginInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type LoginUserInputDTO = z.infer<typeof loginInputSchema>;

export interface LoginUserOutputDTO {
  user: AuthUserDTO;
  tokens: AuthTokensDTO;
}

export const googleLoginInputSchema = z.object({
  idToken: z.string().min(10, "Valid Google ID token is required"),
});

export type GoogleLoginInputDTO = z.infer<typeof googleLoginInputSchema>;

export const refreshTokenInputSchema = z.object({
  refreshToken: z.string().min(10, "Refresh token is required"),
});

export type RefreshTokenInputDTO = z.infer<typeof refreshTokenInputSchema>;

export interface RefreshTokenOutputDTO {
  accessToken: string;
  refreshToken: string;
}

export const verifyOtpInputSchema = z.object({
  email: z.string().email("Invalid email address"),
  otp: z.string().regex(/^\d{6}$/, "OTP must be a 6-digit code"),
});

export type VerifyOtpInputDTO = z.infer<typeof verifyOtpInputSchema>;

export interface VerifyOtpOutputDTO {
  user: AuthUserDTO;
  tokens: AuthTokensDTO;
  message?: string;
}

export const resendOtpInputSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export type ResendOtpInputDTO = z.infer<typeof resendOtpInputSchema>;

export interface ResendOtpOutputDTO {
  message: string;
}
