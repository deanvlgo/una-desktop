export type AuthenticatedUser = {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  organization_id?: string | null;
  role_id?: string | null;
  is_active: boolean;
};
