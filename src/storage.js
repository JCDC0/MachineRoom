export function store() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
