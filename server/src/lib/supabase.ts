import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️  SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set. Database features disabled.');
}

// Service-role client (server-side only – bypasses Row Level Security)
export const supabase = createClient(supabaseUrl || '', supabaseServiceKey || '', {
  auth: { persistSession: false }
});

// ─── Helper: get/create user from Supabase auth data ────────────────────────
export async function upsertUser(authUser: {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
}) {
  const { data, error } = await supabase
    .from('users')
    .upsert(
      {
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.full_name ?? null,
        avatar_url: authUser.avatar_url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ─── Helper: get user by telegram chat ID ────────────────────────────────────
export async function getUserByTelegramId(telegramChatId: number) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_chat_id', telegramChatId)
    .single();

  if (error) return null;
  return data;
}

export async function getUserById(userId: string) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data;
}

// ─── Helper: link telegram chat ID to user ───────────────────────────────────
export async function linkTelegramUser(userId: string, telegramChatId: number) {
  const { error } = await supabase
    .from('users')
    .update({
      telegram_chat_id: telegramChatId,
      telegram_linked_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) throw error;
}

export async function countLinkedTelegramUsers() {
  const { count, error } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .not('telegram_chat_id', 'is', null);

  if (error) throw error;
  return count || 0;
}

// ─── Helper: verify a JWT and return the user ────────────────────────────────
export async function verifyAndGetUser(token: string) {
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
