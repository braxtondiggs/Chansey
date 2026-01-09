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
  roles: string[];
  otpEnabled: boolean;
  lastLoginAt: Date | null;
  exchanges: ExchangeKey[];
  hide_balance?: boolean;
  algoTradingEnabled?: boolean;
  algoCapitalAllocationPercentage?: number;
  algoEnrolledAt?: Date;
}
