---
name: connect-mcp
description: Run this project's notebooks on a remote Jupyter Server's kernel (GPU) via jupyter-mcp-server. Accepts an SSH command (auto tunnel) or a Jupyter URL + token; also handles status check and disconnect. "jupyter 繋いで", "connect jupyter", "jupyter mcp", "remote kernel", "jupyter status", "jupyter 切断" などで起動。
argument-hint: "<ssh command | jupyter url | status | disconnect> [--token TOKEN] [--remote-port N] [--local-port N] [--remote-notebook] [--doc-root DIR]"
compatibility: Requires ssh, curl, jq, uv (uvx)
allowed-tools:
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup-tunnel.sh *)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/doc-server.sh *)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/update-config.sh *)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/status.sh)
  - Bash(bash ${CLAUDE_PLUGIN_ROOT}/scripts/stop-tunnel.sh *)
  - Bash(curl *)
  - Bash(ssh *)
  - Read
  - AskUserQuestion
---

# Jupyter MCP

リモートの Jupyter Server を [jupyter-mcp-server](https://github.com/datalayer/jupyter-mcp-server) 経由でプロジェクトに接続する。

- **hybrid (既定)**: notebook はローカル (doc server、`DOCUMENT_URL`)、カーネルはリモート (`CODE_SANDBOX_URL`)
- **`--remote-notebook`**: notebook もリモートに置く (`JUPYTER_URL`)

`.mcp.json` には wrapper (`~/.config/jupyter-mcp/wrapper.sh`) を指すエントリだけを書き、URL/token は wrapper が起動時に `~/.config/jupyter-mcp/current.env` から読む。接続先を変えても `/mcp` の reconnect で反映される。

<ARGUMENTS>
$ARGUMENTS
</ARGUMENTS>

## Operations

| 操作 | 入力 | 動作 |
|---|---|---|
| connect (既定) | SSH コマンド or URL | 下記 Connect |
| status | `status`, 「状態確認」 | `bash ${CLAUDE_PLUGIN_ROOT}/scripts/status.sh` を実行して要約 |
| disconnect | `disconnect`, 「切断」 | `bash ${CLAUDE_PLUGIN_ROOT}/scripts/stop-tunnel.sh [port\|all]` (既定 all)。doc server も止める。`.mcp.json` は残す |

オプション: `--token` / `--remote-port` (既定 8888) / `--local-port` (既定 48888) / `--remote-notebook` / `--doc-root DIR` (doc server の公開ディレクトリ、既定はプロジェクトルート)。

token の解決順: 明示指定 → URL の `?token=` (URL はオリジンだけ使う) → SSH なら `ssh ... 'echo $JUPYTER_TOKEN'`、空なら `jupyter server list` の出力 → token なしで疎通確認し、401/403 ならユーザーに聞く。

## Connect

1. **リモート URL を決める**。URL ならそのまま使う。SSH コマンドならトンネルを張る:

   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/setup-tunnel.sh "<ssh command>" [remote_port] [local_port]
   ```

   `JUPYTER_URL=` を出力する。`BatchMode=yes` なので鍵認証のみ。失敗したら stderr の SSH ログから原因を伝える。

2. **疎通確認**。401/403 なら token、接続不可ならリモートの Jupyter 起動を確認する:

   ```bash
   curl -fsS --max-time 10 -H "Authorization: token <TOKEN>" "<REMOTE_URL>/api/kernels"
   ```

3. **doc server を起動** (hybrid のみ)。`DOCUMENT_URL=` / `DOCUMENT_TOKEN=` を出力する。同じ root なら再利用する。初回は uvx の環境構築に 1 分ほどかかる:

   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/doc-server.sh start "<DOC_ROOT>"
   ```

4. **設定を書く**。token がなければ `""` を渡す。`--remote-notebook` のときは末尾 2 引数を省く:

   ```bash
   bash ${CLAUDE_PLUGIN_ROOT}/scripts/update-config.sh "<REMOTE_URL>" "<TOKEN>" .mcp.json "<DOCUMENT_URL>" "<DOCUMENT_TOKEN>"
   ```

   最終行が `ENTRY_ADDED` ならセッション再起動と MCP の承認、`ENTRY_UNCHANGED` なら `/mcp` から reconnect するよう案内する。

## Known limitations

問題が起きたときに伝える:

- **`--remote-notebook` にはリモート側の `jupyter-collaboration` が必要**: ないと、セル操作が `/api/collaboration/session/...` の 404 で失敗する (`use_notebook` は成功する)。hybrid に切り替える、`execute_code` で代替する、リモートに `pip install jupyter-collaboration` して Jupyter を再起動する、のいずれかを案内する
- **JupyterLab UI で開くと kernel 選択が出る**: MCP と同じ状態を触るなら "Use existing kernel" を選ぶ。新しい kernel を選ぶと状態が分かれる
- **hybrid には jupyter-mcp-server 1.5.2 以降が必要**: `use_notebook` が `not found in jupyter server` や `Unknown sandbox variant` で失敗したら版を確認する:

  ```bash
  uvx --from jupyter-mcp-server python -c "import jupyter_mcp_server as m; print(m.__version__)"
  ```

  古ければ uv の `exclude-newer` が原因。急ぐなら `uvx --exclude-newer-package jupyter-mcp-server=<date> --exclude-newer-package code-sandboxes=<date> --from "jupyter-mcp-server>=1.5.2" jupyter-mcp-server` で回避する
- **パスの基準が 2 つある**: `use_notebook` のパスは doc server の root からの相対で、root 外は扱えない (`--doc-root` で起動し直す)。notebook 内の相対パスと `list_files` はリモート側を指すので、データセットはリモートに置く

## Examples

```
/jupyter:connect-mcp ssh -p 22078 root@203.0.113.10 -i ~/.ssh/runpod --token abc123
/jupyter:connect-mcp https://abcdef-8888.proxy.runpod.net/?token=abc123 --remote-notebook
/jupyter:connect-mcp status
/jupyter:connect-mcp disconnect
```
