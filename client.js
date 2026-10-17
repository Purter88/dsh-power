/**
 * Client half of the dsh power-controls bundle.
 *
 * Settings → General gains one row with power and restart buttons. Confirming
 * either action calls this package's own authenticated local route; a
 * frame-wide status overlay (registered in `shell.overlay`, so it survives
 * closing the Settings panel) reports progress and reloads the page once a
 * restarted host answers again.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-power',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    const NS = 'dsh-power'
    const KNOWN_ERROR_CODES = new Set([
      'no-exit',
      'desktop-hosted',
      'helper-missing',
      'busy',
      'spawn-failed',
      'unstable-port',
    ])

    const zh = {
      'row.title': 'dsh 电源',
      'row.description': '关闭或重启正在运行的 dsh 服务。操作会中断正在进行的会话。',
      'row.close': '关闭 dsh',
      'row.restart': '重启 dsh',
      'dialog.close.title': '关闭 dsh？',
      'dialog.close.body': 'dsh 会停止运行，正在进行的会话会被中断，此页面将断开连接。',
      'dialog.restart.title': '重启 dsh？',
      'dialog.restart.body': 'dsh 会先停止再自动重新启动，服务恢复后此页面会自动刷新。正在进行的会话会被中断。',
      'dialog.cancel': '取消',
      'dialog.confirmClose': '关闭 dsh',
      'dialog.confirmRestart': '重启 dsh',
      'state.closing': '正在关闭 dsh…',
      'state.restarting': '正在重启 dsh…',
      'state.restartHint': '服务恢复后此页面会自动刷新。',
      'state.closed.title': 'dsh 已关闭',
      'state.closed.body': '现在可以关闭此页面。下次启动 dsh 后，重新打开原来的地址即可继续使用。',
      'state.timeout.title': '操作未完成',
      'state.timeout.close': '请求已发送，但 dsh 仍在运行。可以稍后手动检查，或刷新页面重试。',
      'state.timeout.restart': 'dsh 没有在 45 秒内恢复。可以查看系统临时目录中的 dsh-power-restart.log，或手动启动 dsh。',
      'state.error.title': '操作失败',
      'state.dismiss': '知道了',
      'state.reload': '刷新页面',
      unsupported: '当前运行方式不支持自动重启',
      'err.no-exit': '当前 dsh 没有提供进程退出接口。',
      'err.desktop-hosted': '当前 dsh 由桌面应用托管，请在桌面应用中退出或重启。',
      'err.helper-missing': '找不到重启辅助脚本，请重新安装插件。',
      'err.busy': '另一个电源操作正在进行。',
      'err.spawn-failed': '无法启动重启进程。',
      'err.unstable-port': '当前 dsh 使用系统分配的端口，重启后地址会变化，无法自动恢复此页面。',
      'err.unauthorized': '页面没有执行此操作的权限，请刷新页面后重试。',
      'err.unknown': '未知错误。',
    }

    const en = {
      'row.title': 'dsh power',
      'row.description': 'Stop or restart the running dsh service. Running sessions are interrupted.',
      'row.close': 'Power off dsh',
      'row.restart': 'Restart dsh',
      'dialog.close.title': 'Power off dsh?',
      'dialog.close.body': 'dsh will stop, running sessions are interrupted, and this page loses its connection.',
      'dialog.restart.title': 'Restart dsh?',
      'dialog.restart.body': 'dsh stops and starts again automatically; this page reloads when the service is back. Running sessions are interrupted.',
      'dialog.cancel': 'Cancel',
      'dialog.confirmClose': 'Power off dsh',
      'dialog.confirmRestart': 'Restart dsh',
      'state.closing': 'Stopping dsh…',
      'state.restarting': 'Restarting dsh…',
      'state.restartHint': 'This page reloads automatically when the service is back.',
      'state.closed.title': 'dsh is off',
      'state.closed.body': 'You can close this page. Open the same address again after starting dsh.',
      'state.timeout.title': 'The action did not finish',
      'state.timeout.close': 'The request was sent but dsh is still running. Check it later or reload this page.',
      'state.timeout.restart': 'dsh did not come back within 45 seconds. Check dsh-power-restart.log in the system temp folder, or start dsh manually.',
      'state.error.title': 'The action failed',
      'state.dismiss': 'Dismiss',
      'state.reload': 'Reload page',
      unsupported: 'Automatic restart is unavailable in this run mode',
      'err.no-exit': 'This dsh did not provide a process exit request.',
      'err.desktop-hosted': 'dsh is hosted by the desktop app; quit or restart it from there.',
      'err.helper-missing': 'The restart helper script is missing; reinstall this plugin.',
      'err.busy': 'Another power action is already in progress.',
      'err.spawn-failed': 'Could not start the relaunch process.',
      'err.unstable-port': 'dsh is using an OS-assigned port, so its address changes on restart and this page cannot follow it.',
      'err.unauthorized': 'This page is not allowed to perform the action. Reload and try again.',
      'err.unknown': 'Unknown error.',
    }

    const CSS = `
.dsh-power-setting {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 12px 24px; padding: 16px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
}
.dsh-power-setting-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1 1 180px; }
.dsh-power-setting-title { color: var(--dsw-alias-label-primary); font-size: 14px; line-height: 20px; }
.dsh-power-setting-description { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-power-setting-actions { display: flex; align-items: center; gap: 8px; flex: none; }
.dsh-power-action {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 12px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent;
  color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 500;
  cursor: pointer; white-space: nowrap;
  transition: background 120ms ease, border-color 120ms ease, opacity 120ms ease;
}
.dsh-power-action:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); border-color: var(--dsw-alias-border-l2); }
.dsh-power-action:active:not(:disabled) { transform: translateY(0.5px); }
.dsh-power-action:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-power-action:disabled { opacity: 0.45; cursor: default; }
.dsh-power-action[data-tone='danger'] svg { color: var(--dsw-alias-state-error-primary); }
.dsh-power-action[data-tone='brand'] svg { color: var(--dsw-alias-brand-primary); }
.dsh-power-backdrop {
  position: fixed; inset: 0; z-index: 1000;
  display: grid; place-items: center; padding: 24px;
  background: rgba(10, 14, 20, 0.32);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
}
.dsh-power-card {
  width: min(360px, calc(100vw - 48px));
  box-sizing: border-box; padding: 20px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 16px;
  background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32);
  animation: dsh-power-pop 150ms ease-out;
}
.dsh-power-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.dsh-power-dialog-icon {
  display: grid; place-items: center; flex: none;
  width: 38px; height: 38px; border-radius: 12px;
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-brand-primary);
}
.dsh-power-dialog-icon[data-tone='danger'] { color: var(--dsw-alias-state-error-primary); }
.dsh-power-title { margin: 0; font-size: 15px; line-height: 1.35; font-weight: 600; }
.dsh-power-body { margin: 0 0 16px; font-size: 13px; line-height: 1.55; color: var(--dsw-alias-label-secondary); }
.dsh-power-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.dsh-power-primary, .dsh-power-secondary {
  height: 34px; padding: 0 14px; border-radius: 9px;
  font: inherit; font-size: 13px; font-weight: 600; cursor: pointer;
  transition: filter 120ms ease, background 120ms ease;
}
.dsh-power-primary { border: 0; color: #fff; }
.dsh-power-primary[data-tone='danger'] { background: var(--dsw-alias-state-error-primary); }
.dsh-power-primary[data-tone='brand'] { background: var(--dsw-alias-brand-primary); }
.dsh-power-primary:hover:not(:disabled) { filter: brightness(1.08); }
.dsh-power-primary:focus-visible, .dsh-power-secondary:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dsh-power-primary:disabled { opacity: 0.5; cursor: default; }
.dsh-power-secondary {
  border: 1px solid var(--dsw-alias-border-l1);
  background: transparent; color: var(--dsw-alias-label-primary);
}
.dsh-power-secondary:hover { background: var(--dsw-alias-bg-layer-2); }
.dsh-power-status { text-align: center; }
.dsh-power-status .dsh-power-head { flex-direction: column; gap: 10px; margin-bottom: 14px; }
.dsh-power-status .dsh-power-dialog-icon { width: 46px; height: 46px; border-radius: 14px; }
.dsh-power-status .dsh-power-actions { justify-content: center; }
.dsh-power-error { margin: 0 0 14px; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); word-break: break-word; }
.dsh-power-spinner {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  animation: dsh-power-spin 720ms linear infinite;
}
@keyframes dsh-power-spin { to { transform: rotate(360deg); } }
@keyframes dsh-power-pop { from { opacity: 0; transform: translateY(6px) scale(0.985); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .dsh-power-action, .dsh-power-card, .dsh-power-primary, .dsh-power-secondary { transition: none; animation: none; }
  .dsh-power-spinner { animation-duration: 1600ms; }
}
`

    const status = {
      phase: 'idle',
      action: 'restart',
      failure: null,
      capabilities: { exit: true, restart: true },
    }
    const listeners = new Set()
    let timer = 0

    /** Notify every mounted half of the shared status. */
    function emit() {
      for (const listener of [...listeners]) listener()
    }

    /**
     * Patch the shared status and publish one change.
     * @param {Partial<typeof status>} next - fields to replace.
     */
    function patch(next) {
      Object.assign(status, next)
      emit()
    }

    /**
     * Subscribe a component to status changes.
     * @param {() => void} listener - re-render callback.
     * @returns {() => void} unsubscribe.
     */
    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    /** @returns {typeof status} the current shared status. */
    function current() {
      return status
    }

    /** Re-render on every status change. */
    function useStatus() {
      const [, force] = React.useReducer((value) => value + 1, 0)
      React.useEffect(() => subscribe(force), [])
      return current()
    }

    function clearTimer() {
      if (timer !== 0) window.clearTimeout(timer)
      timer = 0
    }

    /**
     * Replace the one pending status timer.
     * @param {() => void} callback - next poll step.
     * @param {number} delay - delay in milliseconds.
     */
    function schedule(callback, delay) {
      clearTimer()
      timer = window.setTimeout(callback, delay)
    }

    /**
     * Read one JSON response without letting a non-JSON body mask the status.
     * @param {Response} res - fetch response.
     * @returns {Promise<any>} parsed body, or null.
     */
    async function readJson(res) {
      try {
        return await res.json()
      } catch {
        return null
      }
    }

    /** @returns {Promise<boolean>} whether the local liveness route answered. */
    async function pingServer() {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timeout = controller !== null ? window.setTimeout(() => controller.abort(), 2500) : 0
      try {
        const res = await fetch('/dsh-power/ping', {
          cache: 'no-store',
          signal: controller !== null ? controller.signal : undefined,
        })
        return res.ok
      } finally {
        if (timeout !== 0) window.clearTimeout(timeout)
      }
    }

    /** @returns {Promise<{exit: boolean, restart: boolean} | null>} host capabilities. */
    async function readCapabilities() {
      const res = await fetch('/dsh-power/ping', { cache: 'no-store' })
      if (!res.ok) return null
      const body = await readJson(res)
      const capabilities = body !== null && typeof body === 'object' ? body.capabilities : null
      if (capabilities === null || typeof capabilities !== 'object') return null
      return { exit: capabilities.exit !== false, restart: capabilities.restart !== false }
    }

    /**
     * POST one power action.
     * @param {'close' | 'restart'} action - route to call.
     * @returns {Promise<object>} accepted response body.
     */
    async function postAction(action) {
      const res = await fetch(`/dsh-power/${action}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      })
      const body = await readJson(res)
      if (!res.ok) {
        const error = new Error(
          body !== null && typeof body === 'object' && typeof body.detail === 'string' ? body.detail : `HTTP ${res.status}`,
        )
        if (body !== null && typeof body === 'object' && typeof body.code === 'string') error.code = body.code
        error.status = res.status
        throw error
      }
      return body !== null && typeof body === 'object' ? body : {}
    }

    /** Poll until the stopped host stays unreachable. */
    function waitForStop() {
      const started = Date.now()
      let misses = 0
      const tick = async () => {
        let up = false
        try {
          up = await pingServer()
        } catch {
          up = false
        }
        misses = up ? 0 : misses + 1
        if (misses >= 2) {
          patch({ phase: 'closed' })
          return
        }
        if (Date.now() - started > 12000) {
          patch({ phase: 'timeout' })
          return
        }
        schedule(tick, 400)
      }
      schedule(tick, 450)
    }

    /** Poll until the restarted host answers, then reload this page. */
    function waitForRestart() {
      const started = Date.now()
      let misses = 0
      const tick = async () => {
        let up = false
        try {
          up = await pingServer()
        } catch {
          up = false
        }
        if (up) {
          if (misses >= 2) {
            window.location.reload()
            return
          }
          misses = 0
        } else {
          misses += 1
        }
        if (Date.now() - started > 45000) {
          patch({ phase: 'timeout' })
          return
        }
        schedule(tick, 500)
      }
      schedule(tick, 400)
    }

    /**
     * Run one action and follow it to a terminal status.
     * @param {'close' | 'restart'} action - selected action.
     */
    async function begin(action) {
      if (status.phase !== 'idle') return
      clearTimer()
      patch({ phase: action === 'close' ? 'closing' : 'restarting', action, failure: null })
      try {
        await postAction(action)
        if (action === 'close') waitForStop()
        else waitForRestart()
      } catch (error) {
        // A transport failure can race the host's own shutdown: the response
        // may be cut after the action was accepted. Only an HTTP status is a
        // definite refusal; a bare network error keeps waiting for the host.
        if (error !== null && typeof error === 'object' && typeof error.status === 'number') {
          patch({ phase: 'error', failure: error })
          return
        }
        if (action === 'close') waitForStop()
        else waitForRestart()
      }
    }

    /** Return to the resting status after a terminal message is acknowledged. */
    function dismiss() {
      clearTimer()
      patch({ phase: 'idle', failure: null })
    }

    /**
     * @param {unknown} failure - thrown action failure.
     * @param {(key: string) => string} t - locale lookup.
     * @returns {string} localized error text.
     */
    function describeFailure(failure, t) {
      if (failure === null || failure === undefined) return ''
      const code = typeof failure === 'object' && failure !== null ? failure.code : undefined
      if (typeof code === 'string' && KNOWN_ERROR_CODES.has(code)) {
        const extra =
          code === 'spawn-failed' && typeof failure.message === 'string' && failure.message.length > 0
            ? ` ${failure.message}`
            : ''
        return t(`err.${code}`) + extra
      }
      if (typeof failure === 'object' && failure !== null && (failure.status === 401 || failure.status === 403)) {
        return t('err.unauthorized')
      }
      return typeof failure === 'object' && failure !== null && typeof failure.message === 'string' && failure.message.length > 0
        ? failure.message
        : t('err.unknown')
    }

    /** Power glyph. */
    function IconPower({ size = 16 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('path', { d: 'M12 3.4v8.2' }),
        h('path', { d: 'M7.1 6.3a7.6 7.6 0 1 0 9.8 0' }),
      )
    }

    /** Restart glyph. */
    function IconRestart({ size = 16 }) {
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.9,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('path', { d: 'M20.2 11.8a8.2 8.2 0 1 1-2.4-5.8' }),
        h('path', { d: 'M20.4 3.6v6h-6' }),
      )
    }

    /** Small indeterminate spinner. */
    function Spinner() {
      return h('span', { className: 'dsh-power-spinner', 'aria-hidden': true })
    }

    /** Confirmation card for one power action. */
    function ConfirmDialog({ action, t, onCancel, onConfirm }) {
      const cardRef = React.useRef(null)
      React.useEffect(() => {
        const node = cardRef.current
        if (node === null) return
        const target = node.querySelector('[data-autofocus]')
        if (target !== null && typeof target.focus === 'function') target.focus()
      }, [action])
      React.useEffect(() => {
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onCancel])

      const dismiss = (event) => {
        if (event.target === event.currentTarget) onCancel()
      }
      const closeMode = action === 'close'
      return ReactDOM.createPortal(
        h(
          'div',
          { className: 'dsh-power-backdrop', role: 'presentation', onMouseDown: dismiss },
          h(
            'div',
            {
              className: 'dsh-power-card',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-labelledby': 'dsh-power-dialog-title',
              ref: cardRef,
            },
            h(
              'div',
              { className: 'dsh-power-head' },
              h(
                'div',
                { className: 'dsh-power-dialog-icon', 'data-tone': closeMode ? 'danger' : undefined },
                h(closeMode ? IconPower : IconRestart, { size: 20 }),
              ),
              h(
                'h2',
                { className: 'dsh-power-title', id: 'dsh-power-dialog-title' },
                t(closeMode ? 'dialog.close.title' : 'dialog.restart.title'),
              ),
            ),
            h('p', { className: 'dsh-power-body' }, t(closeMode ? 'dialog.close.body' : 'dialog.restart.body')),
            h(
              'div',
              { className: 'dsh-power-actions' },
              h(
                'button',
                { type: 'button', className: 'dsh-power-secondary', 'data-autofocus': true, onClick: onCancel },
                t('dialog.cancel'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-power-primary',
                  'data-tone': closeMode ? 'danger' : 'brand',
                  onClick: onConfirm,
                },
                t(closeMode ? 'dialog.confirmClose' : 'dialog.confirmRestart'),
              ),
            ),
          ),
        ),
        document.body,
      )
    }

    /** Frame-wide blocking status; returns null while idle. */
    function PowerStatus({ t }) {
      const state = useStatus()
      const phase = state.phase
      if (phase === 'idle') return null

      const working = phase === 'closing' || phase === 'restarting'
      let icon = h(Spinner)
      let title = t(phase === 'closing' ? 'state.closing' : 'state.restarting')
      let body = phase === 'restarting' ? t('state.restartHint') : ''
      let errorText = ''
      let actions = null

      if (phase === 'closed') {
        icon = h(IconPower, { size: 24 })
        title = t('state.closed.title')
        body = t('state.closed.body')
        actions = h(
          'div',
          { className: 'dsh-power-actions' },
          h('button', { type: 'button', className: 'dsh-power-primary', 'data-tone': 'brand', onClick: dismiss }, t('state.dismiss')),
        )
      } else if (phase === 'timeout') {
        icon = h(IconPower, { size: 24 })
        title = t('state.timeout.title')
        body = t(state.action === 'close' ? 'state.timeout.close' : 'state.timeout.restart')
        actions = h(
          'div',
          { className: 'dsh-power-actions' },
          h('button', { type: 'button', className: 'dsh-power-secondary', onClick: dismiss }, t('state.dismiss')),
          h(
            'button',
            { type: 'button', className: 'dsh-power-primary', 'data-tone': 'brand', onClick: () => window.location.reload() },
            t('state.reload'),
          ),
        )
      } else if (phase === 'error') {
        icon = h(IconPower, { size: 24 })
        title = t('state.error.title')
        body = ''
        errorText = describeFailure(state.failure, t)
        actions = h(
          'div',
          { className: 'dsh-power-actions' },
          h('button', { type: 'button', className: 'dsh-power-primary', 'data-tone': 'brand', onClick: dismiss }, t('state.dismiss')),
        )
      }

      return ReactDOM.createPortal(
        h(
          'div',
          { className: 'dsh-power-backdrop', role: 'presentation' },
          h(
            'div',
            {
              className: 'dsh-power-card dsh-power-status',
              role: working ? 'status' : 'alertdialog',
              'aria-modal': working ? undefined : 'true',
              'aria-live': 'polite',
              'aria-labelledby': 'dsh-power-status-title',
            },
            h(
              'div',
              { className: 'dsh-power-head' },
              h(
                'div',
                {
                  className: 'dsh-power-dialog-icon',
                  'data-tone': phase === 'timeout' || phase === 'error' ? 'danger' : undefined,
                },
                icon,
              ),
              h('h2', { className: 'dsh-power-title', id: 'dsh-power-status-title' }, title),
            ),
            body.length > 0 ? h('p', { className: 'dsh-power-body' }, body) : null,
            errorText.length > 0 ? h('p', { className: 'dsh-power-error' }, errorText) : null,
            actions,
          ),
        ),
        document.body,
      )
    }

    /**
     * General Settings row: label, description, and the two actions.
     * @param {{t?: (key: string) => string}} props - locale props.
     */
    function PowerSettingsRow(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const state = useStatus()
      const [dialog, setDialog] = React.useState(null)
      const busy = state.phase !== 'idle'
      const close = () => setDialog(null)
      const confirm = () => {
        const action = dialog
        setDialog(null)
        if (action !== null) begin(action)
      }

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { className: 'dsh-power-setting' },
          h(
            'div',
            { className: 'dsh-power-setting-text' },
            h('div', { className: 'dsh-power-setting-title' }, t('row.title')),
            h('div', { className: 'dsh-power-setting-description' }, t('row.description')),
          ),
          h(
            'div',
            { className: 'dsh-power-setting-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-power-action',
                'data-tone': 'danger',
                disabled: busy || state.capabilities.exit === false,
                onClick: () => setDialog('close'),
              },
              h(IconPower, { size: 16 }),
              h('span', null, t('row.close')),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dsh-power-action',
                'data-tone': 'brand',
                title: state.capabilities.restart === false ? t('unsupported') : undefined,
                disabled: busy || state.capabilities.restart === false,
                onClick: () => setDialog('restart'),
              },
              h(IconRestart, { size: 16 }),
              h('span', null, t('row.restart')),
            ),
          ),
        ),
        dialog !== null
          ? h(ConfirmDialog, {
              action: dialog,
              t,
              onCancel: close,
              onConfirm: confirm,
            })
          : null,
      )
    }

    /**
     * Mount dictionaries, stylesheet, Settings row, and the frame-wide status.
     * @param {object} ctx - Client plugin context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-power: dictionaries')
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = '@local/dsh-power'
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => {
          tag.remove()
        }
      }, 'dsh-power: styles')
      ctx.effect(() => {
        readCapabilities()
          .then((next) => {
            if (next !== null) patch({ capabilities: next })
          })
          .catch(() => {})
        return () => {
          clearTimer()
          listeners.clear()
        }
      }, 'dsh-power: host capabilities')

      ctx.slots.inject('settings.general.item', () =>
        ctx.slots.register(
          {
            name: 'settings.general.item',
            id: 'dsh-power',
            order: 95,
            locale: NS,
          },
          PowerSettingsRow,
        ),
      )
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register(
          {
            name: 'shell.overlay',
            id: 'dsh-power-status',
            order: 100,
            locale: NS,
          },
          PowerStatus,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply,
    }
  },
})
