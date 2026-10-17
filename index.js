/**
 * Host half of the dsh power-controls bundle.
 *
 * It owns one authenticated command surface on the local web server:
 * `POST /dsh-power/close` stops the running dsh through the launcher's own
 * shutdown path, and `POST /dsh-power/restart` first starts a detached helper
 * that waits for this process to exit and then relaunches the identical
 * command line. `GET /dsh-power/ping` is an unauthenticated liveness probe the
 * Client half polls while it waits for the restarted host to come back.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROUTE_PREFIX = '/dsh-power'
const HELPER_PATH = fileURLToPath(new URL('./restart-helper.cjs', import.meta.url))
const SHUTDOWN_DELAY_MS = 200

/**
 * Write one JSON response and resolve once its bytes reached the socket.
 * @param res - raw Node response owned by this route.
 * @param status - HTTP status code.
 * @param body - JSON-serializable payload.
 */
function writeJson(res, status, body) {
  return new Promise((resolve) => {
    if (res.writableEnded || res.destroyed) {
      resolve()
      return
    }
    let settled = false
    const settle = () => {
      if (settled) return
      settled = true
      clearTimeout(fallback)
      resolve()
    }
    // A client that disconnects mid-response must not hold up the shutdown.
    const fallback = setTimeout(settle, 150)
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    })
    res.end(payload, settle)
  })
}

/**
 * Refuse every method but the one this route implements.
 * @param req - incoming request.
 * @param res - response to answer when the method differs.
 * @param method - the one accepted method.
 * @returns true when the request may continue.
 */
function allowOnly(req, res, method) {
  if (req.method === method) return true
  res.writeHead(405, { allow: method, 'cache-control': 'no-store' })
  res.end()
  return false
}

/**
 * Apply the browser Host/Origin fence and the signed session cookie.
 * @param connection - `ctx.connection`, whose admission owns the cookie check.
 * @param req - incoming request.
 * @param res - response to answer when admission is rejected.
 * @returns true when the request carries an authenticated owner Peer.
 */
function authorize(connection, req, res) {
  if (typeof connection?.requestRejection !== 'function') {
    res.writeHead(503, { 'cache-control': 'no-store' })
    res.end('connection admission unavailable')
    return false
  }
  const rejection = connection.requestRejection(req)
  if (rejection === undefined) return true
  res.writeHead(rejection, { 'cache-control': 'no-store' })
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return false
}

/**
 * Start a detached helper that waits for this process and its port to go away
 * before relaunching the exact executable, arguments, working directory and
 * environment this process started with.
 * @param webServer - local web server, read for its listening port.
 * @returns completion once the helper process was created.
 */
function startRelauncher(webServer) {
  const args = [...process.execArgv, ...process.argv.slice(1)]
  const env = { ...process.env }
  if (process.versions.electron !== undefined) env.ELECTRON_RUN_AS_NODE = '1'
  const port = typeof webServer.port === 'number' ? webServer.port : 0
  const child = spawn(
    process.execPath,
    [HELPER_PATH, process.execPath, String(process.pid), String(port), process.cwd(), JSON.stringify(args)],
    {
      cwd: process.cwd(),
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    },
  )
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, 1500)
    child.once('spawn', () => {
      clearTimeout(timer)
      resolve()
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  }).then(() => {
    child.unref()
  })
}

/**
 * Whether this invocation can be relaunched at the same address: not an
 * IPC-hosted Desktop child, with the helper present, and not bound to an
 * OS-assigned port that would change on the next start.
 * @returns true when the restart route may start a relauncher.
 */
function restartSupported() {
  if (process.connected === true) return false
  if (!existsSync(HELPER_PATH)) return false
  const args = process.argv.slice(1)
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--port' && args[index + 1] === '0') return false
    if (args[index] === '--port=0') return false
  }
  return true
}

/**
 * Mount the three exact routes owned by this bundle.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  ctx.inject(['webServer', 'connection'], (scope) => {
    const webServer = scope.webServer
    const connection = scope.connection
    let stopping = false

    /**
     * Read the launcher-owned exit request at call time: it is provided on the
     * host context before the plugin tree mounts, and it is the only path that
     * disposes the whole application before the process exits.
     * @returns the exit request, or undefined for an embedding without one.
     */
    const exitRequest = () => (typeof scope.appExit === 'function' ? scope.appExit : undefined)

    /**
     * Liveness and capability probe. It changes no state and is intentionally
     * unauthenticated so the Client half can observe the restarted host before
     * the browser session is re-established on a reloaded page.
     */
    const ping = async (req, res) => {
      if (!allowOnly(req, res, 'GET')) return
      await writeJson(res, 200, {
        ok: true,
        product: 'dsh-power',
        capabilities: {
          exit: exitRequest() !== undefined,
          restart: exitRequest() !== undefined && restartSupported(),
        },
      })
    }

    /** Stop the host through the launcher's bounded shutdown path. */
    const close = async (req, res) => {
      if (!allowOnly(req, res, 'POST')) return
      if (!authorize(connection, req, res)) return
      const exit = exitRequest()
      if (exit === undefined) {
        await writeJson(res, 503, { ok: false, code: 'no-exit' })
        return
      }
      if (stopping) {
        await writeJson(res, 409, { ok: false, code: 'busy' })
        return
      }
      stopping = true
      await writeJson(res, 202, { ok: true, action: 'close' })
      setTimeout(() => exit(0), SHUTDOWN_DELAY_MS)
    }

    /** Relaunch the identical dsh invocation, then stop this host. */
    const restart = async (req, res) => {
      if (!allowOnly(req, res, 'POST')) return
      if (!authorize(connection, req, res)) return
      const exit = exitRequest()
      if (exit === undefined) {
        await writeJson(res, 503, { ok: false, code: 'no-exit' })
        return
      }
      if (process.connected === true) {
        await writeJson(res, 409, { ok: false, code: 'desktop-hosted' })
        return
      }
      if (!existsSync(HELPER_PATH)) {
        await writeJson(res, 503, { ok: false, code: 'helper-missing' })
        return
      }
      if (!restartSupported()) {
        await writeJson(res, 409, { ok: false, code: 'unstable-port' })
        return
      }
      if (stopping) {
        await writeJson(res, 409, { ok: false, code: 'busy' })
        return
      }
      stopping = true
      try {
        await startRelauncher(webServer)
      } catch (error) {
        stopping = false
        await writeJson(res, 500, {
          ok: false,
          code: 'spawn-failed',
          detail: error instanceof Error ? error.message : String(error),
        })
        return
      }
      await writeJson(res, 202, { ok: true, action: 'restart' })
      setTimeout(() => exit(0), SHUTDOWN_DELAY_MS)
    }

    const routes = [
      { kind: 'exact', path: `${ROUTE_PREFIX}/ping`, handler: ping },
      { kind: 'exact', path: `${ROUTE_PREFIX}/close`, handler: close },
      { kind: 'exact', path: `${ROUTE_PREFIX}/restart`, handler: restart },
    ]
    for (const route of routes) {
      scope.effect(() => webServer.register(route), `dsh-power: ${route.path}`)
    }
  })
}
