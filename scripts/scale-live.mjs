import { fork, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statfsSync, statSync, writeFileSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { readProjectLine } from '../server/doctor.js'
import { createBridge, readTree, readTreePartial } from '../server/index.js'
import { gitPath } from '../server/programPath.js'
import { DEFAULTS, makeScaleTree } from '../src/model/scaleTree.js'
import { prepareWorktree } from './run-lane.mjs'
import { formatRows } from './scale-probe.mjs'

export const LIVE_BUDGET = {
  firstRead: 5000,
  folderGzip: 1000,
  secondFolderGzip: 100,
  rssBytes: 500 * 1024 * 1024,
  heapBytes: 500 * 1024 * 1024,
  newFile: 2000,
  cpuShare: 50,
  lastFile: 3000,
  ignoredEvents: 0,
  doctorRead: 10000,
  gitClean: 2000,
  gitUntracked: 2000,
  gitTracked: 2000,
  worktreeAdd: 30000,
  worktreeReuse: 5000,
  reviews: 5000,
  reviewDiff: 5000,
  plainRead: 1000,
}

const REVIEW_LANE = 'opencode'
const REVIEW_BRANCH = 'p19-review'

export const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024
const BURST_TICK_MS = 50
const GIT_TIMEOUT_MS = 30 * 60 * 1000
const CLOSE_TIMEOUT_MS = 10000

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function sleepUntil(at) {
  return sleep(Math.max(0, at - performance.now()))
}

async function eachLimit(items, limit, fn) {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      await fn(items[index], index)
    }
  })
  await Promise.all(workers)
}

export function parseLiveArgs(argv) {
  const out = {}
  const names = { '--files': 'files', '--folders': 'folders', '--seed': 'seed', '--quiet-ms': 'quietMs' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--keep') {
      out.keep = true
      continue
    }
    if (argv[i] === '--tree-only') {
      out.treeOnly = true
      continue
    }
    if (argv[i] === '--server') {
      const server = argv[i + 1]
      if (!server) throw new Error('--server needs a folder.')
      out.server = server
      i += 1
      continue
    }
    if (!Object.hasOwn(names, argv[i])) throw new Error(`Unknown option ${argv[i]}. Use --files N, --folders N, --seed N, --quiet-ms N, --server FOLDER, --tree-only or --keep.`)
    const value = Number(argv[i + 1])
    if (!Number.isInteger(value) || value < 0) throw new Error(`${argv[i]} needs a whole number.`)
    out[names[argv[i]]] = value
    i += 1
  }
  return out
}

function freeBytesAt(path) {
  const probe = existsSync(path) ? path : dirname(path)
  const stats = statfsSync(probe)
  return Number(stats.bavail) * Number(stats.bsize)
}

function git(dir, args, { allowFailure = false } = {}) {
  const env = { ...process.env }
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL']) delete env[key]
  const result = spawnSync(
    gitPath(),
    [
      '-C',
      dir,
      '-c',
      'user.name=scale',
      '-c',
      'user.email=scale@example.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.autocrlf=false',
      '-c',
      'core.safecrlf=false',
      '-c',
      'core.excludesFile=',
      ...args,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: GIT_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024, env }
  )
  if (result.error) throw result.error
  if (!allowFailure && result.status !== 0) throw new Error(`git ${args[0]} failed: ${String(result.stderr ?? '').trim()}`)
  return result
}

function checkoutMessage(files, folders, seed) {
  return `scale tree ${files} ${folders} ${seed}`
}

function reusableCheckout(dir, message, files) {
  if (!existsSync(join(dir, '.git'))) return false
  const log = git(dir, ['log', '-1', '--format=%s'], { allowFailure: true })
  if (log.status !== 0 || log.stdout.trim() !== message) return false
  const listed = git(dir, ['ls-files', '-z'], { allowFailure: true })
  if (listed.status !== 0) return false
  return listed.stdout.split('\0').filter(Boolean).length === files + 1
}

function cleanBurstFolders(dir) {
  for (const name of ['out', 'dist']) rmSync(join(dir, name), { recursive: true, force: true, maxRetries: 3 })
  rmSync(join(dir, 'new-file.js'), { force: true })
}

function worktreePathFor(dir) {
  return join(dir, '.worktrees', REVIEW_LANE)
}

function removeScaleWorktree(dir, path) {
  if (existsSync(path)) git(dir, ['worktree', 'remove', '--force', path], { allowFailure: true })
  git(dir, ['worktree', 'prune'], { allowFailure: true })
  git(dir, ['branch', '-D', REVIEW_BRANCH], { allowFailure: true })
}

function folderSize(dir) {
  let bytes = 0
  let files = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(path)
      } else if (entry.isFile()) {
        files += 1
        try {
          bytes += statSync(path).size
        } catch {}
      }
    }
  }
  return { bytes, files }
}

function gitFolderAway(dir) {
  return `${dir}-git-away`
}

function restoreGitFolder(dir) {
  const away = gitFolderAway(dir)
  if (existsSync(away) && existsSync(dir) && !existsSync(join(dir, '.git'))) renameSync(away, join(dir, '.git'))
}

async function readPlainFolder(dir) {
  const away = gitFolderAway(dir)
  rmSync(away, { recursive: true, force: true })
  renameSync(join(dir, '.git'), away)
  try {
    const started = performance.now()
    const tree = await readTree(dir)
    return { ms: performance.now() - started, files: tree.files }
  } finally {
    renameSync(away, join(dir, '.git'))
  }
}

async function buildCheckout({ dir, files, folders, seed }) {
  const started = performance.now()
  const message = checkoutMessage(files, folders, seed)
  if (reusableCheckout(dir, message, files)) {
    cleanBurstFolders(dir)
    return { reused: true, ms: 0, scale: makeScaleTree({ files, folders, seed }) }
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.gitignore'), 'dist/\n')
  const scale = makeScaleTree({ files, folders, seed })
  await eachLimit(scale.folders.filter(Boolean), 32, (folder) => mkdir(join(dir, folder), { recursive: true }))
  await eachLimit(scale.files, 64, (file) => writeFile(join(dir, file), 'scale\n'))
  git(dir, ['init', '--quiet', '--initial-branch=main'])
  git(dir, ['add', '-A'])
  git(dir, ['commit', '--quiet', '--no-verify', '-m', message])
  const author = git(dir, ['log', '-1', '--format=%ae'])
  if (author.stdout.trim() !== 'scale@example.invalid') throw new Error('The scale commit has the wrong author.')
  return { reused: false, ms: performance.now() - started, scale }
}

function httpGet(port, path, headers = {}) {
  return new Promise((resolveGet, rejectGet) => {
    const started = performance.now()
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        resolveGet({
          status: res.statusCode,
          headers: res.headers,
          bytes: Buffer.concat(chunks),
          ms: performance.now() - started,
          at: performance.now(),
        })
      })
    })
    req.on('error', rejectGet)
    req.setTimeout(60000, () => req.destroy(new Error(`GET ${path} timed out.`)))
    req.end()
  })
}

export function pathsInTreeEvent(data) {
  if (!data || typeof data !== 'object') return []
  if (data.shape === 'folders' && Array.isArray(data.folders) && Array.isArray(data.files)) {
    const paths = ['']
    for (const entry of data.folders) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const parent = Number(entry[0])
      const name = String(entry[1])
      paths.push(parent === 0 ? name : `${paths[parent] ?? ''}/${name}`)
    }
    const out = []
    for (const run of data.files) {
      if (!Array.isArray(run) || run.length < 2) continue
      const folder = paths[Number(run[0])] ?? ''
      for (const name of run.slice(1)) out.push(folder ? `${folder}/${name}` : String(name))
    }
    return out
  }
  if (!Array.isArray(data.files)) return []
  return data.files.filter((file) => typeof file === 'string')
}

function openTreeStream(port, path) {
  const events = []
  const waiters = new Set()
  let buffer = ''
  let closed = false
  let failure = null
  let openResolve
  let openReject
  const opened = new Promise((resolveOpen, rejectOpen) => {
    openResolve = resolveOpen
    openReject = rejectOpen
  })

  const req = request(
    { host: '127.0.0.1', port, path, method: 'GET', headers: { Accept: 'text/event-stream' } },
    (res) => {
      if (res.statusCode !== 200) {
        failure = new Error(`GET ${path} answered ${res.statusCode}.`)
        openReject(failure)
        res.resume()
        return
      }
      openResolve()
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buffer += chunk
        let end
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const lines = block.split('\n')
          const event = lines.find((line) => line.startsWith('event:'))
          const data = lines.find((line) => line.startsWith('data:'))
          if (!event || event.slice(6).trim() !== 'tree' || !data) continue
          let parsed
          try {
            parsed = JSON.parse(data.slice(5).trim())
          } catch {
            continue
          }
          const entry = { at: performance.now(), data: parsed, paths: pathsInTreeEvent(parsed) }
          events.push(entry)
          for (const waiter of [...waiters]) {
            if (!waiter.test(entry)) continue
            clearTimeout(waiter.timer)
            waiters.delete(waiter)
            waiter.resolve(entry)
          }
        }
      })
    }
  )
  req.on('error', (error) => {
    failure = error
    openReject(error)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    waiters.clear()
  })
  req.end()

  function waitFor(test, timeoutMs, from = 0) {
    for (let i = from; i < events.length; i += 1) if (test(events[i])) return Promise.resolve(events[i])
    if (failure) return Promise.reject(failure)
    if (closed) return Promise.reject(new Error('The tree stream closed.'))
    return new Promise((resolveWait, rejectWait) => {
      const waiter = { test, resolve: resolveWait, reject: rejectWait, timer: null }
      waiter.timer = setTimeout(() => {
        waiters.delete(waiter)
        rejectWait(new Error('The tree event did not arrive.'))
      }, timeoutMs)
      waiters.add(waiter)
    })
  }

  function close() {
    if (closed) return
    closed = true
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(new Error('The tree stream closed.'))
    }
    waiters.clear()
    req.destroy()
  }

  return { events, waitFor, close, opened }
}

function openBridgeChild(dir, serverDir = '') {
  const child = fork(fileURLToPath(import.meta.url), ['--bridge-child', dir, serverDir], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  const pending = new Map()
  let sequence = 0
  let readyResolve
  let readyReject
  let exited = false
  const ready = new Promise((resolveReady, rejectReady) => {
    readyResolve = resolveReady
    readyReject = rejectReady
  })
  child.on('message', (message) => {
    if (message?.type === 'ready') {
      readyResolve(message)
      return
    }
    const waiter = pending.get(message?.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.ok === false) waiter.reject(new Error(message.error ?? 'The bridge child failed.'))
    else waiter.resolve(message)
  })
  child.on('error', (error) => {
    readyReject(error)
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  })
  child.on('exit', (code) => {
    exited = true
    const error = new Error(`The bridge child exited with code ${code}.`)
    readyReject(error)
    for (const waiter of pending.values()) waiter.reject(error)
    pending.clear()
  })

  function ask(type, extra = {}, timeoutMs = CLOSE_TIMEOUT_MS) {
    if (exited) return Promise.reject(new Error('The bridge child is gone.'))
    sequence += 1
    const id = sequence
    return new Promise((resolveAsk, rejectAsk) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        rejectAsk(new Error(`The bridge child did not answer ${type}.`))
      }, timeoutMs)
      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timer)
          resolveAsk(message)
        },
        reject: (error) => {
          clearTimeout(timer)
          rejectAsk(error)
        },
      })
      child.send({ type, id, ...extra })
    })
  }

  async function stop() {
    try {
      await ask('stop')
    } catch {}
    if (!exited) {
      await new Promise((resolveExit) => {
        const timer = setTimeout(() => {
          child.kill()
          resolveExit()
        }, 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolveExit()
        })
      })
    }
  }

  return { child, ready, ask, stop }
}

async function runBridgeChild(dir, serverDir = '') {
  let reads = 0
  let partialReads = 0
  let readMs = 0
  let partialMs = 0
  let readCpuMicros = 0
  let partialCpuMicros = 0
  process.on('disconnect', () => process.exit(0))
  let server = { createBridge, readTree, readTreePartial }
  if (serverDir) {
    const module = await import(pathToFileURL(join(resolve(serverDir), 'server', 'index.js')).href)
    server = {
      createBridge: module.createBridge,
      readTree: module.readTree,
      readTreePartial: module.readTreePartial,
    }
  }
  const bridge = server.createBridge({
    projectRoot: dir,
    port: 0,
    readTree: async (root) => {
      const cpu = process.cpuUsage()
      const started = performance.now()
      try {
        return await server.readTree(root)
      } finally {
        const used = process.cpuUsage(cpu)
        reads += 1
        readMs += performance.now() - started
        readCpuMicros += cpuMicros(used)
      }
    },
    readTreePartial: async (root, names) => {
      const cpu = process.cpuUsage()
      const started = performance.now()
      try {
        return await server.readTreePartial(root, names)
      } finally {
        const used = process.cpuUsage(cpu)
        partialReads += 1
        partialMs += performance.now() - started
        partialCpuMicros += cpuMicros(used)
      }
    },
  })
  process.on('message', (message) => {
    if (message?.type === 'metrics') {
      process.send({
        type: 'metrics',
        id: message.id,
        cpu: process.cpuUsage(),
        rss: process.memoryUsage().rss,
        heap: process.memoryUsage().heapUsed,
        reads,
        partialReads,
        readMs,
        partialMs,
        readCpuMicros,
        partialCpuMicros,
        at: performance.now(),
      })
      return
    }
    if (message?.type === 'stop') {
      bridge
        .stop()
        .then(() => {
          process.send({ type: 'stopped', id: message.id })
          setTimeout(() => process.exit(0), 20)
        })
        .catch(() => process.exit(1))
    }
  })
  const { url } = await bridge.start()
  process.send({ type: 'ready', url, pid: process.pid })
}

function cpuMicros(cpu) {
  return Number(cpu?.user ?? 0) + Number(cpu?.system ?? 0)
}

export async function runScaleLive(options = {}) {
  const settings = {
    files: options.files ?? 200000,
    folders: options.folders ?? 20000,
    seed: options.seed ?? DEFAULTS.seed,
    keep: options.keep ?? false,
    root: options.root ?? join(tmpdir(), 'machineroom-scale'),
    burst: options.burst ?? 2000,
    burstMs: options.burstMs ?? 10000,
    cpuWindowMs: options.cpuWindowMs ?? 3000,
    quietMs: options.quietMs ?? 0,
    server: options.server ?? '',
    treeOnly: options.treeOnly ?? false,
    eventWaitMs: options.eventWaitMs ?? 30000,
    minFreeBytes: options.minFreeBytes ?? MIN_FREE_BYTES,
  }
  const log = options.log ?? console.log
  const free = freeBytesAt(settings.root)
  const drive = parse(resolve(settings.root)).root || settings.root
  log(`free space: ${(free / 1024 / 1024 / 1024).toFixed(1)} GB on ${drive}`)
  if (free < settings.minFreeBytes) {
    throw new Error(`Only ${(free / 1024 / 1024 / 1024).toFixed(1)} GB is free. scale-live needs 2 GB.`)
  }
  mkdirSync(settings.root, { recursive: true })
  const dir = resolve(settings.root, `${settings.files}-${settings.seed}`)
  const worktreePath = worktreePathFor(dir)
  const rows = []
  const row = (stage, ms, budget, size = '') => {
    const entry = { stage, runsAt: 'live', ms, budget, size }
    rows.push(entry)
    log(formatRows([entry]).split('\n')[1])
  }
  let child = null
  let stream = null
  let result = null
  try {
    const build = await buildCheckout({ dir, files: settings.files, folders: settings.folders, seed: settings.seed })
    row('build checkout', build.reused ? 0 : build.ms, null, build.reused ? 'reused' : `${settings.files} files in ${settings.folders} folders`)

    const doctorAt = performance.now()
    const doctorLine = await readProjectLine(dir)
    row('doctor project read', performance.now() - doctorAt, LIVE_BUDGET.doctorRead, doctorLine.text)

    await mkdir(join(dir, 'out'), { recursive: true })
    await mkdir(join(dir, 'dist'), { recursive: true })

    const forkAt = performance.now()
    child = openBridgeChild(dir, settings.server)
    const ready = await child.ready
    const port = Number(new URL(ready.url).port)
    const plain = await httpGet(port, '/api/tree')
    const firstReadMs = performance.now() - forkAt
    if (plain.status !== 200) throw new Error(`GET /api/tree answered ${plain.status}.`)
    const plainTree = JSON.parse(plain.bytes.toString('utf8'))
    const afterRead = await child.ask('metrics')
    const firstFullReadMs = afterRead.readMs
    const firstFullReadCpuMs = afterRead.readCpuMicros / 1000
    row(
      'first tree read',
      firstReadMs,
      LIVE_BUDGET.firstRead,
      `${plainTree.files.length} files, read ${firstFullReadMs.toFixed(0)} ms and ${firstFullReadCpuMs.toFixed(0)} ms CPU`
    )

    const rssEntry = {
      stage: 'bridge RSS after first read',
      runsAt: 'live',
      ms: null,
      budget: LIVE_BUDGET.rssBytes,
      size: `${(afterRead.rss / 1024 / 1024).toFixed(1)} MB`,
      bytes: afterRead.rss,
    }
    rows.push(rssEntry)
    log(formatRows([rssEntry]).split('\n')[1])

    const folder = await httpGet(port, '/api/tree', {
      Accept: 'application/json; shape=folders',
      'Accept-Encoding': 'gzip',
    })
    if (folder.status !== 200) throw new Error(`GET /api/tree in the folder shape answered ${folder.status}.`)
    if (folder.headers['content-encoding'] !== 'gzip') throw new Error('GET /api/tree did not answer with gzip.')
    const folderTree = JSON.parse(gunzipSync(folder.bytes).toString('utf8'))
    row(
      'GET /api/tree, folder shape, gzip',
      folder.ms,
      LIVE_BUDGET.folderGzip,
      `${folder.bytes.length} bytes, ${folderTree.folders.length} folders`
    )

    const secondFolder = await httpGet(port, '/api/tree', {
      Accept: 'application/json; shape=folders',
      'Accept-Encoding': 'gzip',
    })
    if (secondFolder.status !== 200) throw new Error(`The second folder GET answered ${secondFolder.status}.`)
    row(
      'second GET /api/tree, folder shape, gzip',
      secondFolder.ms,
      LIVE_BUDGET.secondFolderGzip,
      `${secondFolder.bytes.length} bytes`
    )

    let cleanGitState = { dirty: false, changeCount: 0 }
    if (!settings.treeOnly) {
      const cleanGit = await httpGet(port, '/api/git')
      if (cleanGit.status !== 200) throw new Error(`GET /api/git answered ${cleanGit.status}.`)
      cleanGitState = JSON.parse(cleanGit.bytes.toString('utf8'))
      row('GET /api/git, clean', cleanGit.ms, LIVE_BUDGET.gitClean, cleanGitState.dirty ? `${cleanGitState.changeCount} changes` : 'clean')
    }


    stream = openTreeStream(port, `/events?tree=folders&since=${folderTree.version}`)
    await stream.opened
    const newPath = 'new-file.js'
    const writeAt = performance.now()
    await writeFile(join(dir, newPath), 'scale\n')
    const newEvent = await stream.waitFor((entry) => entry.paths.includes(newPath), settings.eventWaitMs)
    row('one new file, write to tree event', newEvent.at - writeAt, LIVE_BUDGET.newFile, newPath)

    let quietCpuMs = 0
    let quietFullReads = 0
    let quietPartialReads = 0
    let quietWallMs = 0
    let quietShare = 0
    if (settings.quietMs > 0) {
      const quietBefore = await child.ask('metrics')
      await sleepUntil(newEvent.at + settings.quietMs)
      const quietAfter = await child.ask('metrics')
      quietCpuMs = (cpuMicros(quietAfter.cpu) - cpuMicros(quietBefore.cpu)) / 1000
      quietFullReads = quietAfter.reads - quietBefore.reads
      quietPartialReads = quietAfter.partialReads - quietBefore.partialReads
      quietWallMs = Math.max(1, quietAfter.at - quietBefore.at)
      quietShare = (quietCpuMs / quietWallMs) * 100
    }

    const outBefore = await child.ask('metrics')
    const outReadsBefore = outBefore.reads
    const outPartialBefore = outBefore.partialReads
    const outCpuBefore = outBefore
    const outStartAt = performance.now()
    const ticks = Math.max(1, Math.round(settings.burstMs / BURST_TICK_MS))
    const perTick = Math.max(1, Math.ceil(settings.burst / ticks))
    let lastWriteAt = outStartAt
    let written = 0
    for (let tick = 0; tick < ticks && written < settings.burst; tick += 1) {
      const batch = []
      while (batch.length < perTick && written < settings.burst) {
        batch.push(`f-${written}.js`)
        written += 1
      }
      await eachLimit(batch, 16, (name) => writeFile(join(dir, 'out', name), 'scale\n'))
      lastWriteAt = performance.now()
      await sleepUntil(outStartAt + ((tick + 1) * settings.burstMs) / ticks)
    }
    const lastPath = `out/f-${settings.burst - 1}.js`
    const lastEvent = await stream.waitFor((entry) => entry.paths.includes(lastPath), settings.eventWaitMs)
    const outAfter = await child.ask('metrics')
    const outReadsDuring = outAfter.reads - outReadsBefore
    const outPartialDuring = outAfter.partialReads - outPartialBefore
    row('burst out/, full tree lists', outReadsDuring, null, `${settings.burst} files over ${Math.round(settings.burstMs)} ms`)
    row('burst out/, partial tree lists', outPartialDuring, null, `${settings.burst} files over ${Math.round(settings.burstMs)} ms`)
    row('burst out/, last write to tree event', lastEvent.at - lastWriteAt, LIVE_BUDGET.lastFile, lastPath)
    await sleepUntil(Math.max(performance.now(), lastWriteAt + settings.cpuWindowMs))
    const outCpuAfter = await child.ask('metrics')
    const outCpuMs = (cpuMicros(outCpuAfter.cpu) - cpuMicros(outCpuBefore.cpu)) / 1000
    const outWallMs = Math.max(1, outCpuAfter.at - outCpuBefore.at)
    const outShare = (outCpuMs / outWallMs) * 100
    row('burst out/, bridge CPU share', outShare, LIVE_BUDGET.cpuShare, `${outCpuMs.toFixed(0)} ms over ${Math.round(outWallMs)} ms`)

    let untrackedGitState = { changeCount: 0 }
    if (!settings.treeOnly) {
      const untrackedGit = await httpGet(port, '/api/git')
      if (untrackedGit.status !== 200) throw new Error(`GET /api/git after the out/ burst answered ${untrackedGit.status}.`)
      untrackedGitState = JSON.parse(untrackedGit.bytes.toString('utf8'))
      row('GET /api/git, 2000 untracked', untrackedGit.ms, LIVE_BUDGET.gitUntracked, `${settings.burst} files, ${untrackedGitState.changeCount} changes`)
    }

    const distFirstAt = stream.events.length
    const distCpuBefore = await child.ask('metrics')
    const distStartAt = performance.now()
    written = 0
    let distLastWriteAt = distStartAt
    for (let tick = 0; tick < ticks && written < settings.burst; tick += 1) {
      const batch = []
      while (batch.length < perTick && written < settings.burst) {
        batch.push(`f-${written}.js`)
        written += 1
      }
      await eachLimit(batch, 16, (name) => writeFile(join(dir, 'dist', name), 'scale\n'))
      distLastWriteAt = performance.now()
      await sleepUntil(distStartAt + ((tick + 1) * settings.burstMs) / ticks)
    }
    await sleepUntil(Math.max(performance.now(), distLastWriteAt + settings.cpuWindowMs))
    const distCpuAfter = await child.ask('metrics')
    const distCpuMs = (cpuMicros(distCpuAfter.cpu) - cpuMicros(distCpuBefore.cpu)) / 1000
    const distWallMs = Math.max(1, distCpuAfter.at - distCpuBefore.at)
    const distShare = (distCpuMs / distWallMs) * 100
    const distEvents = stream.events.slice(distFirstAt).filter((entry) => entry.paths.some((path) => path === 'dist' || path.startsWith('dist/')))
    row('burst dist/, tree events naming it', distEvents.length, LIVE_BUDGET.ignoredEvents, `${settings.burst} files over ${Math.round(settings.burstMs)} ms`)
    row('burst dist/, bridge CPU share', distShare, LIVE_BUDGET.cpuShare, `${distCpuMs.toFixed(0)} ms over ${Math.round(distWallMs)} ms`)

    const afterBursts = await child.ask('metrics')
    const heapEntry = {
      stage: 'bridge used heap after the bursts',
      runsAt: 'live',
      ms: null,
      budget: LIVE_BUDGET.heapBytes,
      size: `${(afterBursts.heap / 1024 / 1024).toFixed(1)} MB`,
      bytes: afterBursts.heap,
    }
    rows.push(heapEntry)
    log(formatRows([heapEntry]).split('\n')[1])

    let trackedRestored = true
    let gitTrackedChanges = 0
    let addSize = { bytes: 0, files: 0 }
    let reviewsAhead = 0
    let reviewsFiles = 0
    let diffBytes = 0
    if (!settings.treeOnly) {
      cleanBurstFolders(dir)
      await sleep(1200)
      const trackedFiles = build.scale.files.slice(0, 1000)
      await eachLimit(trackedFiles, 16, (file) => appendFile(join(dir, file), 'scale\n'))
      const trackedGit = await httpGet(port, '/api/git')
      if (trackedGit.status !== 200) throw new Error(`GET /api/git after the tracked change answered ${trackedGit.status}.`)
      const trackedGitState = JSON.parse(trackedGit.bytes.toString('utf8'))
      gitTrackedChanges = trackedGitState.changeCount
      row('GET /api/git, 1000 tracked files changed', trackedGit.ms, LIVE_BUDGET.gitTracked, `${trackedFiles.length} files, ${trackedGitState.changeCount} changes`)
      for (let at = 0; at < trackedFiles.length; at += 200) {
        git(dir, ['checkout', '--', ...trackedFiles.slice(at, at + 200)])
      }
      trackedRestored = git(dir, ['status', '--porcelain', '--untracked-files=no']).stdout.trim() === ''

      removeScaleWorktree(dir, worktreePath)
      const worktreeAt = performance.now()
      const made = prepareWorktree(dir, REVIEW_LANE)
      const worktreeMs = performance.now() - worktreeAt
      addSize = folderSize(made.path)
      row('worktree add', worktreeMs, LIVE_BUDGET.worktreeAdd, `${(addSize.bytes / 1024 / 1024).toFixed(1)} MB in ${addSize.files} files`)

      const reuseAt = performance.now()
      const reused = prepareWorktree(dir, REVIEW_LANE)
      row('worktree reuse', performance.now() - reuseAt, LIVE_BUDGET.worktreeReuse, reused.made ? 'made' : 'reused')

      git(worktreePath, ['switch', '-c', REVIEW_BRANCH])
      await appendFile(join(worktreePath, build.scale.files[0]), 'p19 review\n')
      git(worktreePath, ['add', '--', build.scale.files[0]])
      git(worktreePath, ['commit', '--quiet', '--no-verify', '-m', 'p19 review commit'])

      const reviews = await httpGet(port, '/api/control/reviews')
      if (reviews.status !== 200) throw new Error(`GET /api/control/reviews answered ${reviews.status}.`)
      const reviewsBody = JSON.parse(reviews.bytes.toString('utf8'))
      const lane = Array.isArray(reviewsBody.lanes) ? reviewsBody.lanes.find((entry) => entry.lane === REVIEW_LANE) : null
      if (!lane) throw new Error(`GET /api/control/reviews did not list the ${REVIEW_LANE} lane.`)
      reviewsAhead = lane.ahead
      reviewsFiles = lane.files
      row('GET /api/control/reviews, one lane ahead', reviews.ms, LIVE_BUDGET.reviews, `${lane.ahead} ahead, ${lane.files} files`)

      const diff = await httpGet(port, `/api/control/reviews/${REVIEW_LANE}/diff`)
      if (diff.status !== 200) throw new Error(`GET /api/control/reviews/${REVIEW_LANE}/diff answered ${diff.status}.`)
      const diffBody = JSON.parse(diff.bytes.toString('utf8'))
      const diffFiles = Array.isArray(diffBody.files) ? diffBody.files.length : Number(diffBody.files) || 0
      diffBytes = diffBody.patch.length
      row(`GET /api/control/reviews/${REVIEW_LANE}/diff`, diff.ms, LIVE_BUDGET.reviewDiff, `${diffFiles} files, ${diffBody.patch.length} bytes`)
    } else {
      cleanBurstFolders(dir)
    }

    removeScaleWorktree(dir, worktreePath)
    if (child) {
      await child.stop()
      child = null
    }
    const plainFolder = await readPlainFolder(dir)
    row('plain folder read', plainFolder.ms, LIVE_BUDGET.plainRead, `${plainFolder.files.length} files`)

    const allPaths = new Set()
    for (const entry of stream.events) for (const path of entry.paths) allPaths.add(path)
    result = {
      settings,
      checkout: dir,
      rows,
      tree: plainTree,
      folderTree,
      events: stream.events,
      sentPaths: [...allPaths],
      newFileSeen: stream.events.some((entry) => entry.paths.includes(newPath)),
      ignoredSeen: [...allPaths].filter((path) => path === 'dist' || path.startsWith('dist/')),
      stats: {
        firstReadMs,
        firstFullReadMs,
        firstFullReadCpuMs,
        folderMs: folder.ms,
        folderBytes: folder.bytes.length,
        secondFolderMs: secondFolder.ms,
        heapBytes: afterBursts.heap,
        rssBytes: afterRead.rss,
        newFileMs: newEvent.at - writeAt,
        outReadsDuring,
        outPartialReads: outPartialDuring,
        outCpuMs,
        outWallMs,
        outShare,
        quietMs: settings.quietMs,
        quietCpuMs,
        quietFullReads,
        quietPartialReads,
        quietWallMs,
        quietShare,
        lastFileMs: lastEvent.at - lastWriteAt,
        distEvents: distEvents.length,
        distShare,
        doctorLine: doctorLine.text,
        doctorOk: doctorLine.ok,
        gitCleanChanges: cleanGitState.changeCount,
        gitUntrackedChanges: untrackedGitState.changeCount,
        gitTrackedChanges,
        trackedRestored,
        worktreeBytes: addSize.bytes,
        worktreeFiles: addSize.files,
        reviewsAhead,
        reviewsFiles,
        diffBytes,
        plainReadFiles: plainFolder.files.length,
        plainReadMs: plainFolder.ms,
      },
    }
  } finally {
    if (stream) stream.close()
    if (child) await child.stop()
    restoreGitFolder(dir)
    if (existsSync(dir)) {
      removeScaleWorktree(dir, worktreePath)
      cleanBurstFolders(dir)
      if (!settings.keep) rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
    }
    rmSync(gitFolderAway(dir), { recursive: true, force: true, maxRetries: 3 })
  }
  return result
}

export function formatLiveResult(result) {
  const head = `scale live: ${result.settings.files} files in ${result.settings.folders} folders, seed ${result.settings.seed}, checkout ${result.checkout}`
  const stats = result.stats
  const cost = [
    `full tree read: ${stats.firstFullReadMs.toFixed(0)} ms and ${stats.firstFullReadCpuMs.toFixed(0)} ms CPU`,
    `one new file: ${stats.newFileMs.toFixed(0)} ms to the page`,
    `burst: ${stats.outReadsDuring} full reads, ${stats.outPartialReads} partial reads, ${stats.outCpuMs.toFixed(0)} ms CPU`,
  ]
  if (stats.quietMs > 0) {
    cost.push(
      `quiet ${stats.quietMs} ms after one new file: ${stats.quietFullReads} full reads, ${stats.quietPartialReads} partial reads, ${stats.quietCpuMs.toFixed(0)} ms CPU`
    )
  }
  return [head, formatRows(result.rows), ...cost].join('\n')
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  if (process.argv[2] === '--bridge-child') {
    runBridgeChild(process.argv[3]).catch(() => process.exit(1))
  } else {
    try {
      const options = parseLiveArgs(process.argv.slice(2))
      if (options.quietMs === undefined) options.quietMs = 120000
      const result = await runScaleLive(options)
      console.log(formatLiveResult(result))
    } catch (error) {
      console.error(error.message)
      process.exitCode = 1
    }
  }
}
