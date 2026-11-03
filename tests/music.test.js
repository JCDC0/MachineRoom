import { EventEmitter } from 'node:events'
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MUSIC_LIMIT,
  MUSIC_OPEN_PROBLEM,
  createMusicApi,
  isSafeMusicName,
  listMusic,
  listMusicLibrary,
  musicFolderFor,
  musicLibrary,
  musicOpenCommand,
  musicTrackNames,
  musicType,
  parseRange,
} from '../server/music.js'
import { getJson, startLaneBridge } from './helpers/bridge.js'
import { makeTempDir } from './helpers/tempRoot.js'

const cleanups = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    try {
      await cleanup()
    } catch {}
  }
})

function tempDir(prefix = 'mr-music-') {
  const dir = makeTempDir(prefix)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))
  return dir
}

function musicFolder() {
  const dir = tempDir()
  mkdirSync(join(dir, 'nested', 'inner'), { recursive: true })
  mkdirSync(join(dir, 'Lofi'), { recursive: true })
  mkdirSync(join(dir, 'Technical Calm'), { recursive: true })
  writeFileSync(join(dir, 'beta.mp3'), 'abcdef')
  writeFileSync(join(dir, 'alpha.ogg'), 'ogg')
  writeFileSync(join(dir, 'notes.txt'), 'not music')
  writeFileSync(join(dir, 'nested', 'inner.wav'), 'wav')
  writeFileSync(join(dir, 'nested', 'inner', 'deep.mp3'), 'deep')
  writeFileSync(join(dir, 'nested', 'notes.txt'), 'not music')
  writeFileSync(join(dir, 'Lofi', 'calm.mp3'), 'calm')
  writeFileSync(join(dir, 'Lofi', 'another.ogg'), 'another')
  writeFileSync(join(dir, 'Technical Calm', 'focus.m4a'), 'focus')
  return dir
}

async function bridgeFor(folder = musicFolder()) {
  const started = await startLaneBridge({ bridge: { musicFolder: folder } })
  cleanups.push(() => started.stop())
  return { url: started.url, folder }
}

describe('the music folder', () => {
  it('resolves from the install folder, then the environment, then the option', () => {
    const install = tempDir()
    expect(musicFolderFor({ env: {}, installFolder: install })).toBe(join(resolve(install), 'music'))
    const override = tempDir()
    expect(musicFolderFor({ env: { MACHINEROOM_MUSIC: override }, installFolder: install })).toBe(resolve(override))
    const chosen = tempDir()
    expect(musicFolderFor({ folder: chosen, env: { MACHINEROOM_MUSIC: override }, installFolder: install })).toBe(resolve(chosen))
  })

  it('lists the audio files by name and leaves out the rest', () => {
    expect(musicTrackNames(['b.mp3', 'a.ogg', 'notes.txt', 'C.FLAC', 'x.wav', 'y.m4a', 'z.opus', 'no'])).toEqual([
      'C.FLAC',
      'a.ogg',
      'b.mp3',
      'x.wav',
      'y.m4a',
      'z.opus',
    ])
    const many = Array.from({ length: MUSIC_LIMIT + 5 }, (_, index) => `${String(index).padStart(4, '0')}.mp3`)
    expect(musicTrackNames(many)).toHaveLength(MUSIC_LIMIT)
    expect(musicTrackNames(null)).toEqual([])
  })

  it('returns only files at the top of a folder', async () => {
    const folder = musicFolder()
    expect(await listMusic(folder)).toEqual(['alpha.ogg', 'beta.mp3'])
    expect(await listMusic(join(folder, 'missing'))).toEqual([])
  })

  it('lists one playlist per subfolder, by name, and skips folders inside them', async () => {
    const folder = musicFolder()
    mkdirSync(join(folder, 'Empty'), { recursive: true })
    const library = await listMusicLibrary(folder)
    expect(library.tracks).toEqual(['alpha.ogg', 'beta.mp3'])
    expect(library.playlists).toEqual([
      { name: 'Empty', tracks: [] },
      { name: 'Lofi', tracks: ['another.ogg', 'calm.mp3'] },
      { name: 'Technical Calm', tracks: ['focus.m4a'] },
      { name: 'nested', tracks: ['inner.wav'] },
    ])
    expect(await listMusicLibrary(join(folder, 'missing'))).toEqual({ tracks: [], playlists: [] })
  })

  it('caps every playlist and the loose tracks together at the track limit', () => {
    const many = (prefix) => Array.from({ length: 300 }, (_, index) => `${prefix}-${String(index).padStart(3, '0')}.mp3`)
    const library = musicLibrary(['loose.mp3'], [
      { name: 'B', tracks: many('b') },
      { name: 'A', tracks: many('a') },
    ])
    expect(library.playlists[0].tracks).toHaveLength(300)
    expect(library.playlists[1].tracks).toHaveLength(200)
    expect(library.tracks).toEqual([])
    const total = library.tracks.length + library.playlists.reduce((sum, playlist) => sum + playlist.tracks.length, 0)
    expect(total).toBe(MUSIC_LIMIT)
    expect(musicLibrary(['a.mp3', 'b.mp3'], [{ name: 'A', tracks: ['c.mp3'] }], 2)).toEqual({
      tracks: ['a.mp3'],
      playlists: [{ name: 'A', tracks: ['c.mp3'] }],
    })
  })

  it('refuses a separator or a parent link in a name', () => {
    expect(isSafeMusicName('song.mp3')).toBe(true)
    expect(isSafeMusicName('a song.mp3')).toBe(true)
    expect(isSafeMusicName('..')).toBe(false)
    expect(isSafeMusicName('../song.mp3')).toBe(false)
    expect(isSafeMusicName('a/song.mp3')).toBe(false)
    expect(isSafeMusicName('a\\song.mp3')).toBe(false)
    expect(isSafeMusicName('')).toBe(false)
    expect(isSafeMusicName(null)).toBe(false)
  })

  it('gives each extension its content type', () => {
    expect(musicType('a.mp3')).toBe('audio/mpeg')
    expect(musicType('a.ogg')).toBe('audio/ogg')
    expect(musicType('a.wav')).toBe('audio/wav')
    expect(musicType('a.m4a')).toBe('audio/mp4')
    expect(musicType('a.flac')).toBe('audio/flac')
    expect(musicType('a.opus')).toBe('audio/ogg')
    expect(musicType('a.txt')).toBe('application/octet-stream')
  })

  it('reads a byte range or marks it unsatisfiable', () => {
    expect(parseRange('bytes=1-3', 6)).toEqual({ start: 1, end: 3 })
    expect(parseRange('bytes=2-', 6)).toEqual({ start: 2, end: 5 })
    expect(parseRange('bytes=-2', 6)).toEqual({ start: 4, end: 5 })
    expect(parseRange('bytes=4-99', 6)).toEqual({ start: 4, end: 5 })
    expect(parseRange('bytes=99-', 6)).toEqual({ unsatisfiable: true })
    expect(parseRange('bytes=3-2', 6)).toEqual({ unsatisfiable: true })
    expect(parseRange('bytes=0-1,3-4', 6)).toEqual({ unsatisfiable: true })
    expect(parseRange('items=0-1', 6)).toBeNull()
  })
})

describe('the music routes', () => {
  it('lists the tunes, the folder and the playlists', async () => {
    const { url, folder } = await bridgeFor()
    const answer = await getJson(`${url}/api/music`)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({
      folder: resolve(folder),
      tracks: ['alpha.ogg', 'beta.mp3'],
      playlists: [
        { name: 'Lofi', tracks: ['another.ogg', 'calm.mp3'] },
        { name: 'Technical Calm', tracks: ['focus.m4a'] },
        { name: 'nested', tracks: ['inner.wav'] },
      ],
    })
  })

  it('serves a file with its type and supports a byte range', async () => {
    const { url } = await bridgeFor()
    const whole = await fetch(`${url}/music/beta.mp3`)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('audio/mpeg')
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(await whole.text()).toBe('abcdef')

    const part = await fetch(`${url}/music/beta.mp3`, { headers: { Range: 'bytes=1-3' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 1-3/6')
    expect(part.headers.get('content-length')).toBe('3')
    expect(await part.text()).toBe('bcd')

    const suffix = await fetch(`${url}/music/beta.mp3`, { headers: { Range: 'bytes=-2' } })
    expect(suffix.status).toBe(206)
    expect(await suffix.text()).toBe('ef')
  })

  it('answers 416 for a range past the end', async () => {
    const { url } = await bridgeFor()
    const answer = await fetch(`${url}/music/beta.mp3`, { headers: { Range: 'bytes=99-' } })
    expect(answer.status).toBe(416)
    expect(answer.headers.get('content-range')).toBe('bytes */6')
  })

  it('answers 404 for a missing file and 400 for a separator or parent link', async () => {
    const { url } = await bridgeFor()
    expect((await fetch(`${url}/music/missing.mp3`)).status).toBe(404)
    expect((await fetch(`${url}/music/%2e%2e%2fsecret.mp3`)).status).toBe(400)
    expect((await fetch(`${url}/music/a%5Cb.mp3`)).status).toBe(400)
  })

  it('serves a playlist track with its type and a byte range', async () => {
    const { url } = await bridgeFor()
    const whole = await fetch(`${url}/music/Lofi/calm.mp3`)
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('audio/mpeg')
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(await whole.text()).toBe('calm')

    const spaced = await fetch(`${url}/music/Technical%20Calm/focus.m4a`)
    expect(spaced.status).toBe(200)
    expect(spaced.headers.get('content-type')).toBe('audio/mp4')
    expect(await spaced.text()).toBe('focus')

    const part = await fetch(`${url}/music/nested/inner.wav`, { headers: { Range: 'bytes=0-1' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-type')).toBe('audio/wav')
    expect(part.headers.get('content-range')).toBe('bytes 0-1/3')
    expect(await part.text()).toBe('wa')
  })

  it('checks each part of a playlist path and refuses a folder inside one', async () => {
    const { url } = await bridgeFor()
    expect((await fetch(`${url}/music/Lofi/missing.mp3`)).status).toBe(404)
    expect((await fetch(`${url}/music/nested/inner/deep.mp3`)).status).toBe(404)
    expect((await fetch(`${url}/music/%2e%2e%2fsecret.mp3`)).status).toBe(400)
    expect((await fetch(`${url}/music/Lofi/%2e%2e%2fsecret.mp3`)).status).toBe(400)
    expect((await fetch(`${url}/music/Lofi%2f..%2fsecret.mp3`)).status).toBe(400)
    expect((await fetch(`${url}/music/a%5Cb.mp3`)).status).toBe(400)
  })

  it('answers an empty list with the folder still named', async () => {
    const folder = tempDir()
    const { url } = await bridgeFor(folder)
    const answer = await getJson(`${url}/api/music`)
    expect(answer.status).toBe(200)
    expect(answer.body).toEqual({ folder: resolve(folder), tracks: [], playlists: [] })
  })

  it('destroys its file stream when the response closes', async () => {
    const dir = tempDir()
    const file = join(dir, 'test.mp3')
    writeFileSync(file, 'sample music content')
    let stream = null
    const api = createMusicApi({
      folder: dir,
      createStream: (filePath, options) => {
        stream = createReadStream(filePath, options)
        return stream
      },
    })
    const res = new EventEmitter()
    res.writeHead = () => {}
    res.write = () => true
    res.end = () => {}
    res.destroy = () => {}
    const req = { method: 'GET', headers: {} }
    await api.handle(req, res, new URL('http://localhost/music/test.mp3'))

    expect(stream).not.toBeNull()
    expect(stream.destroyed).toBe(false)
    res.emit('close')
    expect(stream.destroyed).toBe(true)
  })
})

function fakeOpener({ fail = false } = {}) {
  const calls = []
  function spawn(command, args, options) {
    const child = {
      once(event, fn) {
        if ((event === 'spawn' && !fail) || (event === 'error' && fail)) queueMicrotask(fn)
        return child
      },
      unref() {
        child.unreferenced = true
      },
    }
    calls.push({ command, args, options, child })
    return child
  }
  return { calls, spawn }
}

async function postOpen(url, { origin, body = { confirmed: true } } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (origin) headers.origin = origin
  return fetch(`${url}/api/music/open`, { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('the music folder opener', () => {
  it('builds the command for each platform and fails when the program is missing', () => {
    expect(musicOpenCommand('C:\\music', { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } })).toEqual({
      command: 'C:\\Windows\\explorer.exe',
      args: ['C:\\music'],
    })
    expect(musicOpenCommand('/music', {
      platform: 'darwin',
      env: { PATH: '/usr/bin' },
      check: (path) => path === '/usr/bin/open',
    })).toEqual({ command: '/usr/bin/open', args: ['/music'] })
    expect(musicOpenCommand('/music', {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      check: (path) => path === '/usr/bin/xdg-open',
    })).toEqual({ command: '/usr/bin/xdg-open', args: ['/music'] })
    expect(musicOpenCommand('/music', {
      platform: 'linux',
      env: { PATH: '/usr/bin' },
      check: () => false,
    })).toBeNull()
  })

  it('opens a confirmed page request and makes the folder first', async () => {
    const folder = join(tempDir(), 'music')
    const opener = fakeOpener()
    const started = await startLaneBridge({ bridge: { musicFolder: folder, musicPlatform: 'win32', musicSpawn: opener.spawn } })
    cleanups.push(() => started.stop())

    const noOrigin = await postOpen(started.url)
    expect(noOrigin.status).toBe(403)

    const unconfirmed = await postOpen(started.url, { origin: started.url, body: { confirmed: false } })
    expect(unconfirmed.status).toBe(400)
    expect(existsSync(folder)).toBe(false)

    const opened = await postOpen(started.url, { origin: started.url })
    expect(opened.status).toBe(204)
    expect(existsSync(folder)).toBe(true)
    expect(opener.calls).toHaveLength(1)
    expect(opener.calls[0].command).toMatch(/^[A-Za-z]:\\.*explorer\.exe$/i)
    expect(opener.calls[0].args).toEqual([resolve(folder)])
    expect(opener.calls[0].options).toMatchObject({ detached: true, stdio: 'ignore', shell: false })
    expect(opener.calls[0].child.unreferenced).toBe(true)
  })

  it('answers 501 with one sentence when no file manager can be started', async () => {
    const folder = join(tempDir(), 'music')
    const opener = fakeOpener({ fail: true })
    const started = await startLaneBridge({ bridge: { musicFolder: folder, musicPlatform: 'win32', musicSpawn: opener.spawn } })
    cleanups.push(() => started.stop())

    const answer = await postOpen(started.url, { origin: started.url })
    expect(answer.status).toBe(501)
    expect(await answer.json()).toEqual({ error: MUSIC_OPEN_PROBLEM })
    expect(existsSync(folder)).toBe(true)
  })
})
