import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// 웹은 anon key 전용 (RLS: 읽기만 허용). service_role 키는 Pi에만 존재.
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
