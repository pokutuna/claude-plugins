# jupyter

リモートの Jupyter Server (RunPod, GCP, 自前サーバーなど) のカーネルを、[jupyter-mcp-server](https://github.com/datalayer/jupyter-mcp-server) 経由で Claude Code から使うプラグイン。

既定は **hybrid 構成**: notebook はプロジェクト内のローカルファイル、カーネルだけリモート (GPU) で動く。pod を消しても notebook と実行結果は手元に残る。

## Usage

```
/jupyter:connect-mcp ssh -p 22078 root@203.0.113.10 -i ~/.ssh/runpod   # SSH トンネルを張って接続
/jupyter:connect-mcp https://abcdef-8888.proxy.runpod.net/?token=abc123 # URL で接続
/jupyter:connect-mcp <url> --remote-notebook  # notebook もリモートに置く
/jupyter:connect-mcp status
/jupyter:connect-mcp disconnect               # トンネルと doc server を停止
```

## How it works

- `.mcp.json` には wrapper (`~/.config/jupyter-mcp/wrapper.sh`) を指すエントリだけを書く。token を含まないので git 管理してよい
- URL/token は `~/.config/jupyter-mcp/current.env` に置き、wrapper が起動時に読む。接続先を変えたら `/mcp` から reconnect すれば反映される
- hybrid では `jupyter-collaboration` 入りの jupyter-server (doc server) を uvx でローカルに起動し、プロジェクトディレクトリを公開する

## Requirements

- `ssh`, `curl`, `jq`, `uv`
- リモートで Jupyter Server が起動していること
- `--remote-notebook` ではリモートに `jupyter-collaboration` が必要 (RunPod の PyTorch テンプレには入っていない)

## Notes

- カーネルはリモートなので、notebook 内の相対パスと `list_files` はリモート側を指す。データセットはリモートに置く
- JupyterLab UI で開いたときは "Use existing kernel" を選ぶと MCP と同じ状態を触れる
