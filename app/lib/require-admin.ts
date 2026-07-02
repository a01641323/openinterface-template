import { cookies } from 'next/headers';
import { isValidAdminSession } from './admin-auth';

export const ADMIN_COOKIE = 'admin_session';

export async function requireAdmin(): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return false;
  const store = await cookies();
  return isValidAdminSession(store.get(ADMIN_COOKIE)?.value, password);
}
