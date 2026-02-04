/**
 * User roles enum - shared between backend and frontend.
 * Values match the PostgreSQL enum 'role_enum' in the database.
 */
export enum Role {
  USER = 'user',
  ADMIN = 'admin'
}
