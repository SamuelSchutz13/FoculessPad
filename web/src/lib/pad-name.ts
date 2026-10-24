const VALID = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*$/

/** Same rules as the API: lowercase, segments [a-z0-9_-]+ joined by "/", up to 200 chars. */
export function normalizePadName(raw: string): string {
  const name = raw.toLowerCase()
  if (name.length > 200 || !VALID.test(name)) throw new Error('Invalid pad name')
  return name
}
