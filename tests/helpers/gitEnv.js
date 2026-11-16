const REPO_KEYS = new Set(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR'])

export function withoutRepoEnv(base = process.env) {
  const env = { ...base }
  for (const key of Object.keys(env)) {
    if (REPO_KEYS.has(key.toUpperCase())) delete env[key]
  }
  return env
}
