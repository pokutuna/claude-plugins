# octave-notification

Play musical scale notification sounds based on the herdr tab position or tmux window index. Each tab or window gets a unique pitch, so you can tell which session completed by ear.

## How it works

A `Notification` hook plays a bell-like WAV file when Claude Code sends a notification (e.g., task completion after being idle for 6+ seconds). The pitch corresponds to the position of the pane's herdr tab, or to the tmux window index. In herdr, tabs are counted across all workspaces in sidebar order, so two tabs in the same workspace get different pitches, like tmux windows do. When herdr runs inside tmux, the herdr tab position is used.

- Supports macOS (`afplay`) and Linux (`paplay`, `pw-play`, `aplay`)
- Under herdr, the tab position needs `jq`. If it cannot be read, the tmux window index is used when herdr runs inside tmux
- Falls back to the lowest note (B3) if neither index can be read
- Uses the highest note (B6) if the index exceeds the range

## Sound map

22 notes: B3 + 3 octaves (C4 - B6), mapped to index 0-21. Index 1 = C4 (Do), so herdr tabs (counted from 1) and tmux with `base-index 1` get Do-Re-Mi starting from the first one.

| Index | Note | Frequency (Hz) |
|------:|:-----|----------------:|
|     0 | B3   |          246.94 |
|     1 | C4   |          261.63 |
|     2 | D4   |          293.66 |
|     3 | E4   |          329.63 |
|     4 | F4   |          349.23 |
|     5 | G4   |          392.00 |
|     6 | A4   |          440.00 |
|     7 | B4   |          493.88 |
|     8 | C5   |          523.25 |
|     9 | D5   |          587.33 |
|    10 | E5   |          659.26 |
|    11 | F5   |          698.46 |
|    12 | G5   |          783.99 |
|    13 | A5   |          880.00 |
|    14 | B5   |          987.77 |
|    15 | C6   |         1046.50 |
|    16 | D6   |         1174.66 |
|    17 | E6   |         1318.51 |
|    18 | F6   |         1396.91 |
|    19 | G6   |         1567.98 |
|    20 | A6   |         1760.00 |
|    21 | B6   |         1975.53 |

Index > 21 uses B6 (the highest note).

## Files

```
octave-notification/
  .claude-plugin/plugin.json   # Plugin manifest
  hooks/hooks.json             # Notification hook definition
  bin/generate-sounds.py       # WAV generator script (uv run compatible)
  bin/play-notification.sh     # Playback script (macOS/Linux)
  sounds/bell_{0..20}.wav      # Pre-generated bell sounds
```

## Regenerating sounds

```sh
uv run bin/generate-sounds.py
```
