import { Role } from './role.enum';

import { ExchangeKey } from '../exchange/exchange.interface';

export interface IUser {
  id: string;
  email: string;
  emailVerified: boolean;
  given_name: string | null;
  family_name: string | null;
  middle_name: string | null;
  nickname: string | null;
  picture: string | null;
  gender: string | null;
  birthdate: string | null;
  phone_number: string | null;
  roles: Role[];
  otpEnabled: boolean;
  lastLoginAt: Date | null;
  exchanges: ExchangeKey[];
  hide_balance?: boolean;
  algoTradingEnabled?: boolean;
  algoCapitalAllocationPercentage?: number;
  algoEnrolledAt?: Date;
}

export interface IUserProfileUpdate {
  given_name?: string;
  family_name?: string;
  middle_name?: string;
  nickname?: string;
  picture?: string;
  gender?: string;
  birthdate?: string;
  phone_number?: string;
  risk?: string;
  hide_balance?: boolean;
}

export interface ChangePasswordRequest {
  old_password: string;
  new_password: string;
  confirm_new_password: string;
}
