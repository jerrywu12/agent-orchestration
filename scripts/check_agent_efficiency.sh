#!/usr/bin/env bash
# Configuration/hash checks only: no provider calls and no credentials printed.
set -euo pipefail
python="${AGENT_EFFICIENCY_PYTHON:-$HOME/.local/share/uv/tools/serena-agent/bin/python}"
exec "$python" - <<'PY'
import hashlib,json,os,shutil,subprocess,sys,tomllib
from pathlib import Path
home=Path(os.environ.get('AGENT_EFFICIENCY_HOME',str(Path.home()))).resolve()
share=home/'.local/share/agent-efficiency';failures=[]
def report(label,ok):
 print(('OK ' if ok else 'FAIL ')+label)
 if not ok:failures.append(label)
try:
 registry=json.loads((share/'installed.json').read_text())
 # Agent-owned configs can legitimately change other keys, so verify their managed entries below.
 for path,expected in registry.items():
  p=Path(path)
  if str(p).startswith(str(share)) and p.name!='installed.json' or p.parent==home/'.local/bin':
   report('installed '+p.name,p.is_file() and hashlib.sha256(p.read_bytes()).hexdigest()==expected)
 command=str(home/'.local/bin/agent-serena-mcp')
 for relative in ['.claude.json','.gemini/settings.json','.gemini/config/mcp_config.json']:
  d=json.loads((home/relative).read_text());report(relative+' Serena',d.get('mcpServers',{}).get('serena',{}).get('command')==command)
 d=tomllib.loads((home/'.codex/config.toml').read_text());report('Codex Serena',d.get('mcp_servers',{}).get('serena',{}).get('command')==command)
 for relative in ['.claude/CLAUDE.md','.codex/AGENTS.md','.gemini/GEMINI.md','.gemini/antigravity/global_rules.md']:
  report(relative+' policy','<!-- agent-efficiency:begin -->' in (home/relative).read_text())
 runtime=json.loads((share/'runtime.json').read_text())
 for name in ['python','serena','rtk']:report(name+' executable',os.access(runtime[name],os.X_OK))
 proc=subprocess.run([runtime['rtk'],'--version'],capture_output=True,text=True,timeout=10);print(proc.stdout.strip());report('RTK executable smoke',proc.returncode==0)
 for name in ['claude','codex','gemini','ollama','arkcli']:
  print(('AVAILABLE ' if shutil.which(name) else 'NOT ON PATH ')+name)
 print('Provider auth/inference and GUI MCP reconnection are separate live checks.')
except (OSError,ValueError,KeyError) as exc:
 print('FAIL installation/configuration read: '+type(exc).__name__);sys.exit(1)
sys.exit(bool(failures))
PY
