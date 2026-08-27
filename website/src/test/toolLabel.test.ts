import { describe, it, expect } from 'vitest'
import { clampToolLabel, deriveShellSummary, MAX_TOOL_LABEL_CHARS, pickToolLabel } from '../utils/toolLabel'

describe('clampToolLabel', () => {
  it('leaves a short single-line label untouched', () => {
    expect(clampToolLabel('Read foo.ts')).toBe('Read foo.ts')
  })

  it('keeps only the first line of a multi-line command', () => {
    const heredoc = "cat > /tmp/desc.md <<'EOF'\n### Notes\nbody text\nEOF"
    expect(clampToolLabel(heredoc)).toBe("cat > /tmp/desc.md <<'EOF'…")
  })

  it('does not elide for a trailing newline with nothing after it', () => {
    expect(clampToolLabel('git status\n')).toBe('git status')
  })

  it('caps a long single line at the owning limit', () => {
    const long = 'export PATH=' + 'a'.repeat(400)
    const out = clampToolLabel(long)
    // The cap plus one ellipsis character.
    expect(out).toHaveLength(MAX_TOOL_LABEL_CHARS + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('does not strand whitespace in front of the ellipsis', () => {
    const padded = 'a'.repeat(MAX_TOOL_LABEL_CHARS - 1) + '   tail'
    expect(clampToolLabel(padded)).toBe('a'.repeat(MAX_TOOL_LABEL_CHARS - 1) + '…')
  })

  it('clamps what pickToolLabel falls back to when a call carries no purpose', () => {
    const raw = "cat > /tmp/desc.md <<'EOF'\nlong body\nEOF"
    const picked = pickToolLabel({ simplified: true, purpose: '', rawLabel: raw, uiLang: 'en' })
    // Simplified mode cannot help without a purpose — the raw command comes
    // through, so the clamp is the only thing bounding it.
    expect(picked).toBe(raw)
    expect(clampToolLabel(picked)).toBe("cat > /tmp/desc.md <<'EOF'…")
  })
})

describe('deriveShellSummary', () => {
  it('summarizes a heredoc write to binary plus redirect target', () => {
    const label = "Running: cat > /tmp/cr3_desc.md <<'EOF'\n### Notes\nbody\nEOF"
    expect(deriveShellSummary(label)).toBe('Running: cat → /tmp/cr3_desc.md')
  })

  it('lists the binaries of a chained pipeline, demoting bookkeeping and capping', () => {
    const label = 'Running: export PATH="/usr/local/bin:$PATH" cd /repo; ls -a | grep -i crux || echo none; git -P log --oneline -1; wc -l x'
    // `export` is dropped in favour of binaries that say what the command DOES.
    expect(deriveShellSummary(label)).toBe('Running: ls, grep, echo, git …')
  })

  it('keeps a bookkeeping builtin when it is the whole command', () => {
    // Long enough labels reach derivation via the clamp gate in the component;
    // the helper itself must still answer sensibly for a lone builtin.
    expect(deriveShellSummary('Running: cd /some/very/long/path')).toBe('Running: cd')
  })

  it('reads past a bookkeeping first line in a multi-line script', () => {
    const label = 'Running: export PATH=/usr/local/bin\nbrazil-build release | tee /tmp/build.log'
    expect(deriveShellSummary(label)).toBe('Running: brazil-build, tee')
  })

  it('stops parsing at a heredoc so body lines contribute no binaries', () => {
    const label = "Running: cat > /tmp/x.md <<'EOF'\ngit status\nls -a\nEOF"
    // git/ls inside the heredoc are document text, not commands.
    expect(deriveShellSummary(label)).toBe('Running: cat → /tmp/x.md')
  })

  it('does not split on operators inside quotes', () => {
    expect(deriveShellSummary("Running: grep -E 'foo|bar' file.txt")).toBe('Running: grep')
  })

  it('does not treat 2>&1 as a segment or a target', () => {
    expect(deriveShellSummary('Running: make build 2>&1')).toBe('Running: make')
  })

  it('skips env assignments before the binary', () => {
    expect(deriveShellSummary('Running: FOO=1 BAR=2 python3 -m pytest')).toBe('Running: python3')
  })

  it('returns null for MCP invocations and non-shell titles', () => {
    expect(deriveShellSummary('Running: @kirocrew-core/spawn_run')).toBeNull()
    expect(deriveShellSummary('Editing AGENTS.md')).toBeNull()
  })

  it('derives a bare-command label only when the caller vouches it is shell', () => {
    // The wild flooding session's labels carry no Running: prefix at all —
    // 124 of 124 were bare commands. is_shell from the tool log is the gate.
    const bare = 'export PATH="/usr/local/bin:$PATH" cd /repo; ls -a | grep -i crux'
    expect(deriveShellSummary(bare)).toBeNull()
    expect(deriveShellSummary(bare, { bareCommand: true })).toBe('ls, grep')
    // The vouch does not open the door for non-shell titles' shape to matter:
    // an MCP invocation stays null even when mislabeled as shell.
    expect(deriveShellSummary('@kirocrew-core/spawn_run', { bareCommand: true })).toBeNull()
  })
})
