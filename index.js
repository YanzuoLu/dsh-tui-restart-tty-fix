/**
 * Keep the terminal in raw mode across a dsh-tui `/restart` handoff.
 *
 * `/restart` (and the restart after `/update`) spawns the replacement TUI on
 * the same terminal and keeps this process alive until the replacement exits.
 * Fifteen seconds later the handoff watchdog calls `process.stdin.destroy()`.
 * Closing a TTY handle that was once switched to raw mode makes libuv write
 * back the termios it saved at that switch, and termios belongs to the
 * terminal, not to a process. The replacement is therefore put back into
 * canonical mode with echo while it still has mouse reporting enabled: every
 * mouse report is echoed at the cursor as `^[[<35;x;yM`, and typed keys only
 * reach the TUI after Enter.
 *
 * The plugin keeps what the watchdog wants from `destroy()` (the stream is
 * destroyed and never reads again) but releases the handle without closing
 * it, so the terminal modes stay with the process that now owns the terminal.
 *
 * @module dsh-tui-restart-tty-fix
 */
import { isatty } from 'node:tty'

export const name = 'restart-tty-fix'

const installed = Symbol.for('dsh-tui-restart-tty-fix')

/**
 * `_destroy` for a terminal stdin: stop reading and drop the event-loop
 * reference, but leave the handle open so closing it cannot reset termios.
 * @this {import('node:tty').ReadStream}
 * @param {Error | null} error - error the stream is destroyed with.
 * @param {(error: Error | null) => void} callback - completes the destroy.
 */
function releaseWithoutClosing(error, callback) {
  this._handle?.readStop()
  this.unref()
  callback(error)
}

export function apply() {
  // Only a terminal stdin has termios to lose; checking fd 0 avoids creating process.stdin otherwise.
  if (!isatty(0) || process.stdin[installed]) return
  // Process lifetime on purpose: /restart disposes the plugin tree before the
  // watchdog destroys stdin, so undoing this on dispose would undo the fix.
  process.stdin._destroy = releaseWithoutClosing
  process.stdin[installed] = true
}
