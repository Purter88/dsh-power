/**
 * Detached relauncher for dsh.
 *
 * The Host half starts this script with its own executable and arguments. The
 * helper waits for the old dsh process to leave and for its listening port to
 * be released, then starts the identical command in a new, detached process.
 * Diagnostics are appended to `dsh-power-restart.log` in the OS temp folder.
 */
'use strict'

const { spawn } = require('node:child_process')
const { appendFileSync } = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const LOG_PATH = path.join(os.tmpdir(), 'dsh-power-restart.log')
const WAIT_FOR_EXIT_MS = 30_000
const WAIT_FOR_PORT_MS = 20_000

/**
 * Append one diagnostic line; logging never fails the relaunch.
 * @param {string} message - human-readable observation.
 */
function log(message) {
  try {
    appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // The restart itself does not depend on diagnostics being writable.
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {number} pid - process to test.
 * @returns true while the process exists (EPERM still means it exists).
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/**
 * @param {number} port - local TCP port, 0 skips the probe.
 * @returns true when nothing is listening on 127.0.0.1:port.
 */
function isPortFree(port) {
  if (!Number.isInteger(port) || port <= 0) return Promise.resolve(true)
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const settle = (free) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(free)
    }
    socket.once('connect', () => settle(false))
    socket.once('error', () => settle(true))
    socket.setTimeout(700, () => settle(true))
  })
}

async function main() {
  const [exePath, parentPidText, portText, cwd, argsJson] = process.argv.slice(2)
  const parentPid = Number(parentPidText)
  const port = Number(portText)
  const args = JSON.parse(argsJson)
  if (typeof exePath !== 'string' || !Array.isArray(args)) {
    throw new Error('dsh-power: invalid relaunch request')
  }

  const exitDeadline = Date.now() + WAIT_FOR_EXIT_MS
  while (isAlive(parentPid)) {
    if (Date.now() > exitDeadline) {
      throw new Error(`dsh-power: parent process ${parentPid} did not exit`)
    }
    await sleep(120)
  }

  const portDeadline = Date.now() + WAIT_FOR_PORT_MS
  while (!(await isPortFree(port))) {
    if (Date.now() > portDeadline) {
      throw new Error(`dsh-power: port ${port} stayed busy`)
    }
    await sleep(120)
  }

  // Let profile storage and any other OS handles settle before the new host
  // opens the same files.
  await sleep(300)

  log(`relaunching ${exePath} ${args.join(' ')}`)
  const child = spawn(exePath, args, {
    cwd: typeof cwd === 'string' && cwd.length > 0 ? cwd : process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.once('error', (error) => log(`spawn failed: ${error.message}`))
  child.unref()
  log(`relaunched with pid ${String(child.pid ?? 'unknown')}`)
}

main().catch((error) => {
  log(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
