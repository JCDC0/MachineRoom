import { describe, expect, it } from 'vitest'
import { createMockClient } from '../src/control/mock.js'
import { profileFromBrief } from '../src/policy/profile.js'
import { tierFor } from '../src/policy/route.js'

const fast = () => createMockClient({ latencyMs: 0 })

describe('mock briefs', () => {
  it('lists sample briefs in the contract shape', async () => {
    const briefs = await fast().briefs()
    expect(briefs.map((brief) => brief.id)).toEqual(['B6', 'U4', 'C3e', 'P5', 'M1', 'C2'])
    for (const brief of briefs) {
      for (const key of ['id', 'title', 'ownerText', 'owners', 'done', 'section', 'text']) expect(brief, `${brief.id} ${key}`).toHaveProperty(key)
    }
    expect(briefs.find((brief) => brief.id === 'C2').done).toBe(true)
    expect(briefs.find((brief) => brief.id === 'M1').owners).toEqual(['claude'])
  })

  it('gives the sample briefs a small, a medium and a large tier', async () => {
    const briefs = await fast().briefs()
    const tiers = briefs.map((brief) => tierFor(profileFromBrief(brief)))
    expect(tiers).toContain('small')
    expect(tiers).toContain('medium')
    expect(tiers).toContain('large')
    for (const brief of briefs) {
      const profile = profileFromBrief(brief)
      expect(profile.clarity, brief.id).toBe('clear')
      expect(profile.hasTests, brief.id).toBe(true)
      expect(profile.files, brief.id).toBeGreaterThan(0)
    }
  })

  it('builds the prompt for one brief and one lane', async () => {
    const result = await fast().briefPrompt(['C3e'], 'agy')
    expect(result.lane).toBe('agy')
    expect(result.model).toBe('Gemini 4 Argon')
    expect(result.branch).toBe('feat/c3e-hud-polish')
    expect(result.prompt).toContain('Model to select in agy: Gemini 4 Argon.')
    expect(result.prompt).toContain('Task C3e: HUD polish.')
    expect(result.prompt).toContain('Commit with the prefix 0.1.36')
  })

  it('builds one prompt for two briefs', async () => {
    const result = await fast().briefPrompt(['U4', 'B6'], 'opencode')
    expect(result.prompt).toContain('Do the tasks in order.')
    expect(result.branch).toBe('feat/u4-reject-a-foreign')
  })

  it('refuses an unknown brief, no brief and an unknown lane in plain words', async () => {
    const client = fast()
    await expect(client.briefPrompt(['ZZ9'], 'agy')).rejects.toThrow(/Choose a brief/)
    await expect(client.briefPrompt([], 'agy')).rejects.toThrow(/Choose a brief/)
    await expect(client.briefPrompt(['C3e'], 'nobody')).rejects.toThrow(/Choose hermes/)
  })

  it('can be told to fail once like every other method', async () => {
    const client = fast()
    client.failNext('briefs', 'The bridge is not reachable.')
    await expect(client.briefs()).rejects.toThrow('The bridge is not reachable.')
    await expect(client.briefs()).resolves.toBeTruthy()
  })
})
