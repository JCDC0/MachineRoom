export const SLOW_TEST_TIMEOUT_MS = 60000

const CI_SLOWDOWN = 3

export function slowMs(ms) {
  return process.env.CI ? ms * CI_SLOWDOWN : ms
}
