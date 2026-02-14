---
name: uv-pep723
description: |
  This skill should be used when writing a Python script that uses uv,
  or when the user mentions "uv run", "PEP 723", "uv run --with",
  "inline script metadata". Guides writing self-contained Python scripts
  with inline dependency metadata.
---

# PEP 723 Inline Scripts with uv

## When to Use

| Situation | Approach |
|---|---|
| Project dependencies are sufficient | `uv run script.py` — no PEP 723 needed |
| Needs extra deps + throwaway or rarely-run | PEP 723 inline metadata in the script |
| Temporarily try a package (debugging, etc.) | `uv run --with pkg script.py` |
| Core workflow script (CI, deploy, build) | Add deps to pyproject.toml, not PEP 723 |

Use PEP 723 to keep pyproject.toml clean by not adding dependencies that most workflows don't need.

## Writing a Script

Always include a shebang and PEP 723 metadata block at the top:

```python
#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "requests",
#   "rich",
# ]
# ///

import requests
from rich.pretty import pprint

resp = requests.get("https://example.com/api")
pprint(resp.json())
```

After `chmod +x`, the script is directly executable. uv resolves and installs dependencies automatically.

## Reference

If more detail is needed, consult: https://docs.astral.sh/uv/guides/scripts/#using-a-shebang-to-create-an-executable-file
