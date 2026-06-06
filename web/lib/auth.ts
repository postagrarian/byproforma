export const AUTH_KEY = 'byproforma_auth'

export function isAuthenticated(): boolean {
  if (typeof window === 'undefined') return false
  return localStorage.getItem(AUTH_KEY) === '1'
}

export function logout() {
  localStorage.removeItem(AUTH_KEY)
}
