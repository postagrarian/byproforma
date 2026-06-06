export interface ETFConfig {
  slot: number          // 1–5
  ticker: string
  lastRunDate: string | null
  isConfigured: boolean
}

export interface SectorWeight {
  sector: string
  etfWeight: number
  portfolioWeight: number
  diff: number
}

export interface FactorLoading {
  factor: string
  etfBeta: number
  portfolioBeta: number
  diff: number
}

export interface PortfolioHolding {
  ticker: string
  name:   string
  weight: number
  sector: string
  r2: number
  betaMkt: number
  betaSmb: number
  betaHml: number
  betaRmw: number
  betaCma: number
  betaMom: number
}

export interface ETFOverview {
  name:         string
  description:  string
  expenseRatio: number | null
  aum:          number | null
  holdings:     number | null
  ytd:          number | null
  return1Y:     number | null
}

export interface ETFResult {
  slot: number
  ticker: string
  runDate: string
  sectorWeights: SectorWeight[]
  factorLoadings: FactorLoading[]
  portfolio: PortfolioHolding[]
  factorRmse: number
  maxSectorDiff: number
  etfR2: number | null
  portfolioR2: number | null
  etfOverview: ETFOverview | null
}

export interface PipelineStatus {
  slot: number
  stage: 'idle' | 'holdings' | 'prices' | 'factors' | 'regressions' | 'optimizing' | 'done' | 'error'
  message: string
  progress: number  // 0–100
}
