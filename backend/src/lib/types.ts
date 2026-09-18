export type Env = {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;               // local dev only (.dev.vars)
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_JWT_SECRET?: string;        // only for legacy HS256 projects
  PUBLIC_APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  AVATAR_BUCKET?: string;
  ENVIRONMENT?: string;
};

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: { id: string; code: string; name: string }[];
  permissions: Set<string>;
};

export type Vars = {
  auth: AuthUser;
  db: import('postgres').Sql;
};
