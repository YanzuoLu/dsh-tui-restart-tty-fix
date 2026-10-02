# dsh-tui-restart-tty-fix

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that keeps the terminal in raw mode after a dsh-tui `/restart`. Without it, mouse movement starts printing `^[[<35;37;34M^[[<35;36;34M...` into the prompt about 15 seconds after the restart.

## Symptom

About 15 seconds after `/restart` (or the automatic restart after `/update`), the prompt line fills with text like `^[[<35;37;34M` whenever the mouse moves over the terminal. Typed keys also stop behaving normally: they appear as plain text and reach dsh-tui only after Enter. The text is not part of the prompt's content. It is the terminal echoing input that dsh-tui never receives.

Any terminal or multiplexer shows this as long as mouse reporting is on, which is the default with `fullscreen: true`. Mouse movement makes it obvious because dsh-tui enables any-motion reporting (DECSET 1003).

## Root cause

`restartTui()` in `@deepseek-harness-tui/dsh-tui` (`lib/types/update.js`, dsh-tui 0.12.0) starts the replacement TUI with `stdio: ['inherit', 'inherit', 'pipe']`. The old process stays alive until the replacement exits, and both processes share one terminal. A handoff watchdog in the old process calls `process.stdin.destroy()` on its 15th tick.

Destroying the stream closes the old process's TTY handle. That handle was switched to raw mode earlier, so libuv saved the terminal's original settings at that point, and closing the handle writes those settings back. Terminal settings (termios) belong to the terminal device, not to a process. The replacement TUI is therefore put back into canonical mode with echo while it still has mouse reporting enabled:

- the kernel echoes every mouse report at the cursor, which sits in dsh-tui's prompt, using caret notation (`ESC` is shown as `^[`)
- input is line-buffered, so dsh-tui receives keys only after Enter

The watchdog comment assumes that closing its own handle does not affect the replacement. A minimal Node reproduction (parent sets raw mode, spawns a child that sets raw mode, then calls `process.stdin.destroy()`) shows the terminal returning to `echo icanon` at the destroy. Without the earlier raw-mode switch in the parent, the destroy changes nothing.

## What the plugin does

When stdin is a terminal, the plugin replaces `process.stdin._destroy` with a version that does not close the TTY handle. It stops reading from the handle and unreferences it so the handle cannot keep the event loop alive. `destroy()` still marks the stream as destroyed, so nothing can read from it again, which is what the watchdog needs. The terminal settings stay with the replacement TUI.

The change lasts for the whole process. `/restart` disposes the plugin tree before the watchdog fires, so undoing the change on dispose would remove it too early. The replacement TUI loads the plugin too, which covers a second `/restart` from the replacement. A process whose stdin is not a terminal is left alone.

The plugin does not change mouse modes or other terminal modes, and does not affect normal exits. The process that exits last still restores the terminal as usual.

## Install

```sh
dsh plugin --profile dsh-tui add github:YanzuoLu/dsh-tui-restart-tty-fix   # or link:/path/to/dsh-tui-restart-tty-fix
```

The bundle mounts the plugin at the profile root (`id: restart-tty-fix`). It has no configuration. Check the result with `dsh --profile dsh-tui --dump-config`.

## Removal

Remove the plugin once dsh-tui stops closing the shared TTY handle during the restart handoff (look for the `process.stdin.destroy()` call in `restartTui()` in `lib/types/update.js`):

```sh
dsh plugin --profile dsh-tui remove dsh-tui-restart-tty-fix
```

## Compatibility

This plugin is tested with dsh-tui 0.12.0 on dsh `0.2.0-rc.2` and Node.js 26. It depends only on Node.js built-ins and the `ReadStream` internals `_destroy` and `_handle.readStop()`.

## License

MIT
