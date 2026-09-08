#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
editor_version=6000.6.0f1
unity_editor="${UNITY_EDITOR:-}"
if [ -z "$unity_editor" ]; then
  for candidate in "/Applications/Unity/Hub/Editor/$editor_version/Unity.app/Contents/MacOS/Unity" "$HOME/Applications/Unity/$editor_version/Unity.app/Contents/MacOS/Unity"; do
    if [ -x "$candidate" ]; then unity_editor="$candidate"; break; fi
  done
fi
if [ ! -x "$unity_editor" ]; then
  echo "找不到 Unity $editor_version。请用 Unity Hub 安装 Apple Silicon 编辑器，或设置 UNITY_EDITOR 为 Unity 可执行文件路径。" >&2
  exit 1
fi
action="${1:-open}"
mkdir -p "$project_dir/.local"
if [ "$action" = open ]; then
  exec "$unity_editor" -projectPath "$project_dir" -logFile "$project_dir/.local/editor.log"
fi
mkdir -p "$project_dir/.local/verification"
case "$action" in
  verify) method=Qingyun.PrototypeBuild.Verify ;;
  mac) method=Qingyun.PrototypeBuild.Mac ;;
  web) method=Qingyun.PrototypeBuild.Web ;;
  *) echo "Usage: tools/unity.sh [open|verify|mac|web]" >&2; exit 2 ;;
esac
exec "$unity_editor" -batchmode -nographics -quit -projectPath "$project_dir" -executeMethod "$method" -logFile "$project_dir/.local/verification/unity-$action.log"
