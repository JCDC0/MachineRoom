export function store() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readStorage(key, storage = store()) {
  try {
    return storage ? storage.getItem(key) : null
  } catch {
    return null
  }
}

export function writeStorage(key, value, storage = store()) {
  try {
    if (storage) {
      storage.setItem(key, String(value))
      return true
    }
  } catch {
    return false
  }
  return false
}
