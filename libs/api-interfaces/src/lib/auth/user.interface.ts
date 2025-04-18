export interface IUser {
  id: string;
  email: string;
  email_verified: boolean;
  given_name: string | null;
  family_name: string | null;
  middle_name: string | null;
  nickname: string | null;
  preferred_username: string | null;
  picture: string | null;
  signup_methods: string;
  gender: string | null;
  birthdate: string | null;
  phone_number: string | null;
  phone_number_verified: boolean;
  roles: string[];
  created_at: number;
  updated_at: number;
  is_multi_factor_auth_enabled: boolean | null;
  app_data: Record<string, any>;
}
