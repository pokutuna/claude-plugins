#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
RunPod Pod Creation Script

Reads config from runpod.toml and runs runpodctl create pod.
With --ssh, automatically waits and connects via SSH after creation.

Usage:
  uv run --script create_pod.py                # Create a pod
  uv run --script create_pod.py --ssh           # Create and SSH connect
  uv run --script create_pod.py --dry-run       # Show command only
  uv run --script create_pod.py -c other.toml   # Use a different config
"""

from __future__ import annotations

import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import tomllib
from pathlib import Path

DEFAULTS = {
    "pod": {
        "container_disk_size": 20,
        "gpu_count": 1,
        "secure_cloud": False,
        "ports": ["22/tcp"],
    },
    "volume": {
        "volume_path": "/workspace",
    },
}


def find_config(config_path: str | None) -> Path:
    if config_path:
        p = Path(config_path)
        if not p.exists():
            print(f"Error: Config file not found: {p}", file=sys.stderr)
            sys.exit(1)
        return p

    p = Path.cwd() / "runpod.toml"
    if p.exists():
        return p

    print("Error: runpod.toml not found in current directory", file=sys.stderr)
    print("Use --config to specify the path", file=sys.stderr)
    sys.exit(1)


def load_config(config_path: Path) -> dict:
    with open(config_path, "rb") as f:
        config = tomllib.load(f)

    for section, defaults in DEFAULTS.items():
        if section not in config:
            config[section] = {}
        for key, value in defaults.items():
            config[section].setdefault(key, value)

    config.setdefault("init", {})
    config.setdefault("env", {})

    pod = config.get("pod", {})
    missing = [f"pod.{f}" for f in ("name", "gpu_type", "image") if not pod.get(f)]
    if missing:
        print(
            f"Error: Missing required fields in {config_path}: {', '.join(missing)}",
            file=sys.stderr,
        )
        sys.exit(1)

    return config


def build_env_vars(config: dict) -> list[str]:
    env = dict(config.get("env", {}))

    quota_gb = config.get("volume", {}).get("quota_gb")
    if quota_gb is not None:
        env.setdefault("WORKSPACE_QUOTA_GB", str(quota_gb))

    return [f"{key}={value}" for key, value in env.items()]


def build_create_command(config: dict, env_vars: list[str]) -> list[str]:
    pod = config["pod"]
    volume = config.get("volume", {})

    cmd = [
        "runpodctl",
        "create",
        "pod",
        "--name",
        pod["name"],
        "--gpuType",
        pod["gpu_type"],
        "--imageName",
        pod["image"],
        "--containerDiskSize",
        str(pod["container_disk_size"]),
        "--startSSH",
    ]

    if pod.get("gpu_count", 1) > 1:
        cmd += ["--gpuCount", str(pod["gpu_count"])]

    if pod.get("datacenter_id"):
        cmd += ["--dataCenterId", pod["datacenter_id"]]

    if pod.get("secure_cloud"):
        cmd.append("--secureCloud")

    network_volume_id = volume.get("network_volume_id")
    if network_volume_id:
        cmd += [
            "--networkVolumeId",
            network_volume_id,
            "--volumeSize",
            "0",
            "--volumePath",
            volume.get("volume_path", "/workspace"),
        ]

    ports = pod.get("ports", ["22/tcp"])
    if ports:
        cmd += ["--ports", ",".join(ports)]

    startup_command = pod.get("startup_command")
    if startup_command:
        cmd += ["--args", startup_command]

    for var in env_vars:
        cmd += ["--env", var]

    return cmd


def create_pod(cmd: list[str]) -> str | None:
    result = subprocess.run(cmd, capture_output=True, text=True)
    output = result.stdout + result.stderr
    print(output.rstrip())

    match = re.search(r'pod "([a-z0-9]+)"', output)
    return match.group(1) if match else None


def print_pod_summary(config: dict) -> None:
    pod = config["pod"]
    volume = config.get("volume", {})

    print("Creating RunPod instance...")
    print(f"  Name: {pod['name']}")
    print(f"  GPU: {pod['gpu_type']}")
    if pod.get("datacenter_id"):
        print(f"  Datacenter: {pod['datacenter_id']}")
    print(f"  Image: {pod['image']}")
    if volume.get("network_volume_id"):
        print(
            f"  Network Volume: {volume['network_volume_id']} -> {volume.get('volume_path', '/workspace')}"
        )
    print()


def wait_for_ssh(pod_id: str, timeout: int = 300, interval: int = 5) -> str | None:
    start = time.time()
    while time.time() - start < timeout:
        result = subprocess.run(
            ["runpodctl", "ssh", "connect", pod_id],
            capture_output=True,
            text=True,
        )
        output = result.stdout + result.stderr
        if "ssh " in output:
            print()
            return output

        elapsed = int(time.time() - start)
        print(f"  Not ready yet... ({elapsed}s/{timeout}s)", file=sys.stderr)
        time.sleep(interval)

    return None


def parse_ssh_command(ssh_info: str) -> list[str]:
    for line in ssh_info.splitlines():
        line = line.strip()
        if line.startswith("ssh "):
            return shlex.split(line)

    print(
        f"Error: Could not parse SSH command from output:\n{ssh_info}", file=sys.stderr
    )
    sys.exit(1)


def build_remote_command(config: dict, config_dir: Path) -> str | None:
    """Build a remote command string from init config."""
    init_config = config.get("init", {})
    script_path = init_config.get("script")
    commands = init_config.get("commands", [])
    path_append = config.get("env", {}).get("PATH_APPEND")

    has_init = script_path or commands or path_append
    if not has_init:
        return None

    parts: list[str] = []

    # Load RunPod env vars (.bashrc is not sourced for SSH remote commands)
    parts.append("source /etc/rp_environment 2>/dev/null")

    if path_append:
        parts.append(f'export PATH="$PATH:{path_append}"')

    if script_path:
        full_path = config_dir / script_path
        if not full_path.exists():
            print(f"Error: Init script not found: {full_path}", file=sys.stderr)
            sys.exit(1)
        escaped = shlex.quote(full_path.read_text())
        parts.append(f"bash -c {escaped}")

    for cmd in commands:
        parts.append(cmd)

    # Stay in an interactive shell after init
    parts.append("exec bash")
    return " && ".join(parts)


def build_ssh_args(ssh_cmd: list[str], remote_command: str | None) -> list[str]:
    if not remote_command:
        return ssh_cmd
    return [*ssh_cmd, "-t", remote_command]


def ssh_in_tmux_window(ssh_cmd: list[str], remote_command: str | None) -> None:
    """Open a new local tmux window with an SSH connection."""
    if not os.environ.get("TMUX"):
        print(
            "Warning: Not running inside tmux. Falling back to direct SSH.",
            file=sys.stderr,
        )
        args = build_ssh_args(ssh_cmd, remote_command)
        os.execvp(args[0], args)

    args = build_ssh_args(ssh_cmd, remote_command)
    subprocess.run(["tmux", "new-window", shlex.join(args)], check=True)
    print("Opened new tmux window with SSH connection.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a RunPod pod from runpod.toml")
    parser.add_argument(
        "--config",
        "-c",
        metavar="PATH",
        help="Path to runpod.toml (default: ./runpod.toml)",
    )
    parser.add_argument(
        "--ssh", action="store_true", help="Wait for pod and connect via SSH"
    )
    parser.add_argument("--name", help="Override pod name")
    parser.add_argument("--gpu", help="Override GPU type")
    parser.add_argument("--datacenter", help="Override datacenter ID")
    parser.add_argument(
        "--dry-run", action="store_true", help="Print command without executing"
    )
    args = parser.parse_args()

    if not shutil.which("runpodctl"):
        print(
            "Error: runpodctl not found. Install: https://github.com/runpod/runpodctl",
            file=sys.stderr,
        )
        sys.exit(1)

    config_path = find_config(args.config)
    config = load_config(config_path)
    config_dir = config_path.parent

    if args.name:
        config["pod"]["name"] = args.name
    if args.gpu:
        config["pod"]["gpu_type"] = args.gpu
    if args.datacenter:
        config["pod"]["datacenter_id"] = args.datacenter

    env_vars = build_env_vars(config)
    cmd = build_create_command(config, env_vars)

    if args.dry_run:
        print(shlex.join(cmd))
        return

    print_pod_summary(config)
    pod_id = create_pod(cmd)

    if not pod_id:
        print("Failed to create pod or parse pod ID.", file=sys.stderr)
        sys.exit(1)

    print()
    print(f"Pod created: {pod_id}")
    print("Check status: runpodctl get pod")

    if not args.ssh:
        return

    print()
    print("Waiting for SSH to become available...")
    ssh_info = wait_for_ssh(pod_id)

    if not ssh_info:
        print(f"Timed out. Try: runpodctl ssh connect {pod_id}", file=sys.stderr)
        sys.exit(1)

    ssh_cmd = parse_ssh_command(ssh_info)
    remote_command = build_remote_command(config, config_dir)
    use_tmux = config.get("init", {}).get("tmux_window", False)

    if use_tmux:
        ssh_in_tmux_window(ssh_cmd, remote_command)
    else:
        exec_args = build_ssh_args(ssh_cmd, remote_command)
        print(f"Connecting: {shlex.join(exec_args)}")
        os.execvp(exec_args[0], exec_args)


if __name__ == "__main__":
    main()
