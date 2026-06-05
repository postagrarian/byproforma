import { createClient } from '@supabase/supabase-js'

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

// ── ETF config (which tickers are in each slot) ──────────────────────────
export async function getETFConfigs() {
  const { data, error } = await supabase
    .from('etf_config')
    .select('*')
    .order('slot')
  if (error) throw error
  return data
}

export async function upsertETFConfig(slot: number, ticker: string) {
  const { error } = await supabase
    .from('etf_config')
    .upsert({ slot, ticker: ticker.toUpperCase(), updated_at: new Date().toISOString() })
  if (error) throw error
}

// ── Latest portfolio result for a slot ───────────────────────────────────
export async function getLatestPortfolio(slot: number) {
  const { data, error } = await supabase
    .from('portfolio_runs')
    .select('*')
    .eq('slot', slot)
    .order('run_date', { ascending: false })
    .limit(1)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data
}

export async function getAllLatestPortfolios() {
  const slots = [1, 2, 3, 4, 5]
  return Promise.all(slots.map(getLatestPortfolio))
}
