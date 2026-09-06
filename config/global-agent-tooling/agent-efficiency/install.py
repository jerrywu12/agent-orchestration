#!/usr/bin/env python3
"""Preview/install shared agent tooling without replacing unrelated configuration."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import sys
import tempfile
import tomllib

SOURCE = Path(__file__).resolve().parent
BEGIN = '<!-- agent-efficiency:begin -->'
END = '<!-- agent-efficiency:end -->'


def digest(data):
    return hashlib.sha256(data).hexdigest() if data is not None else None


def read(path):
    return path.read_bytes() if path.exists() else None


def atomic(path, data, mode=0o600):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(prefix='.' + path.name, dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data); out.flush(); os.fsync(out.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        if os.path.exists(name): os.unlink(name)


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True)+'\n').encode()


def safe_path(home, path):
    target = Path(path).resolve()
    if not target.is_relative_to(home) or target == home:
        raise ValueError('target escapes installation home: ' + str(path))
    if target.exists() and not target.is_file():
        raise ValueError('target is not a regular file: ' + str(path))
    return target


class Plan:
    def __init__(self, home):
        self.home = Path(home).resolve()
        self.registry = self.home/'.local/share/agent-efficiency/installed.json'
        self.owned = json.loads(self.registry.read_text()) if self.registry.exists() else {}
        self.entries = {}

    def add(self, path, data, mode=0o600, owned=False):
        path = safe_path(self.home, path)
        before = read(path)
        if owned and before is not None and before != data and self.owned.get(str(path)) != digest(before):
            raise ValueError('unmanaged or modified tool target: ' + str(path))
        entry = dict(path=str(path), before=before, after=data,
                     before_mode=stat.S_IMODE(path.stat().st_mode) if before is not None else None, mode=mode)
        if path in self.entries and self.entries[path]['after'] != data:
            raise ValueError('conflicting targets: '+str(path))
        self.entries[path] = entry

    def changed(self):
        return [e for e in self.entries.values() if e['before'] != e['after'] or e['before_mode'] != e['mode']]

    def apply(self):
        if not self.changed(): return None
        registry = dict(self.owned)
        registry.update({e['path']:digest(e['after']) for e in self.entries.values()})
        self.add(self.registry, json_bytes(registry))
        changes = self.changed()
        for e in changes:
            p=Path(e['path'])
            if read(p) != e['before'] or (p.exists() and stat.S_IMODE(p.stat().st_mode)!=e['before_mode']):
                raise ValueError('concurrent edit before install: '+str(p))
        root=self.home/'.local/share/agent-efficiency/backups'
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        generation=Path(tempfile.mkdtemp(prefix='install-',dir=root)); generation.chmod(0o700)
        records=[]
        for i,e in enumerate(changes):
            backup=generation/(str(i)+'.before')
            if e['before'] is not None: atomic(backup,e['before'])
            records.append(dict(path=e['path'], before_hash=digest(e['before']), after_hash=digest(e['after']),
                                before_mode=e['before_mode'], after_mode=e['mode'],
                                backup=str(backup) if e['before'] is not None else None))
        manifest=generation/'manifest.json'
        atomic(manifest,json_bytes(dict(home=str(self.home),files=records,status='prepared')))
        written=[]
        try:
            for e in changes:
                p=Path(e['path'])
                if read(p)!=e['before'] or (p.exists() and stat.S_IMODE(p.stat().st_mode)!=e['before_mode']): raise ValueError('concurrent edit during install: '+str(p))
                atomic(p,e['after'],e['mode']);written.append(e)
        except BaseException:
            for e in reversed(written):
                p=Path(e['path'])
                if read(p)==e['after']:
                    if e['before'] is None:p.unlink()
                    else:atomic(p,e['before'],e['before_mode'])
            raise
        atomic(manifest,json_bytes(dict(home=str(self.home),files=records,status='applied')))
        return manifest


def rollback(home, manifest):
    home=Path(home).resolve(); manifest=safe_path(home,manifest)
    document=json.loads(manifest.read_text())
    if document['home']!=str(home):raise ValueError('manifest belongs to another home')
    pending=[]
    for e in document['files']:
        p=safe_path(home,e['path']); current=digest(read(p))
        if current==e['before_hash'] and (not p.exists() or stat.S_IMODE(p.stat().st_mode)==e['before_mode']):continue
        if current!=e['after_hash'] or (p.exists() and stat.S_IMODE(p.stat().st_mode)!=e['after_mode']):
            raise ValueError('rollback refused later edit: '+str(p))
        original=None
        if e['backup']:
            b=safe_path(home,e['backup'])
            if not b.is_relative_to(manifest.parent):raise ValueError('backup outside manifest directory')
            original=b.read_bytes()
            if digest(original)!=e['before_hash']:raise ValueError('backup checksum mismatch')
        pending.append((p,original,e['before_mode'],e['after_hash'],e['after_mode']))
    for p,original,mode,expected_hash,expected_mode in reversed(pending):
        if digest(read(p))!=expected_hash or (p.exists() and stat.S_IMODE(p.stat().st_mode)!=expected_mode):
            raise ValueError('rollback refused concurrent edit: '+str(p))
        if original is None:p.unlink()
        else:atomic(p,original,mode)


def merge_json(raw, entry):
    document=json.loads(raw or '{}')
    if not isinstance(document,dict):raise ValueError('config must be an object')
    servers=document.setdefault('mcpServers',{})
    if not isinstance(servers,dict):raise ValueError('mcpServers must be an object')
    if 'serena' in servers and servers['serena']!=entry:
        raise ValueError('existing Serena entry differs; preserving it')
    if servers.get('serena')==entry:return raw
    servers['serena']=entry
    return json_bytes(document).decode()


def merge_toml(raw, command):
    document=tomllib.loads(raw)
    servers=document.get('mcp_servers',{})
    entry=dict(command=command,args=[],startup_timeout_sec=60)
    if 'serena' in servers:
        if servers['serena']!=entry:raise ValueError('existing Serena TOML entry differs; preserving it')
        return raw
    result=raw.rstrip()+'\n\n[mcp_servers.serena]\ncommand = '+json.dumps(command)+'\nargs = []\nstartup_timeout_sec = 60\n'
    tomllib.loads(result)
    return result


def managed_rules(raw, body):
    block=BEGIN+'\n'+body.strip()+'\n'+END
    if BEGIN in raw or END in raw:
        if raw.count(BEGIN)!=1 or raw.count(END)!=1 or raw.index(BEGIN)>raw.index(END):
            raise ValueError('invalid managed rule markers')
        return raw[:raw.index(BEGIN)]+block+raw[raw.index(END)+len(END):]
    return raw+('' if raw.endswith('\n') or not raw else '\n')+'\n'+block+'\n'


def build_plan(home, python, serena, rtk):
    home=Path(home).resolve();plan=Plan(home);share=home/'.local/share/agent-efficiency';bin_dir=home/'.local/bin'
    command=str(bin_dir/'agent-serena-mcp')
    # Parse all global configuration before preparing file copies.
    for name in ['.claude.json','.gemini/settings.json','.gemini/config/mcp_config.json']:
        path=home/name; raw=path.read_text() if path.exists() else ''
        entry={'command':command,'args':[]}
        if name=='.claude.json':entry['type']='stdio'
        plan.add(path,merge_json(raw,entry).encode())
    codex=home/'.codex/config.toml'
    plan.add(codex,merge_toml(codex.read_text() if codex.exists() else '',command).encode())
    notice=f'''## Development efficiency (all projects)
Use `agent-run -- <project check command>` for verbose checks: it preserves the safety guard, exit status and private full log. Use `rtk git status`, `rtk git log` or `rtk grep` for compact discovery; read the full diff for review. Activate the exact absolute worktree in Serena before symbol/reference lookup; request bodies only when needed. Read {share / 'POLICY.md'} for bounded agent delegation and Ollama/ArkCLI advice. Preserve project rules and gates; load only the relevant task packet and evidence. This applies to current and future projects.'''
    for name in ['.claude/CLAUDE.md','.codex/AGENTS.md','.gemini/GEMINI.md','.gemini/antigravity/global_rules.md']:
        p=home/name
        plan.add(p,managed_rules(p.read_text() if p.exists() else '',notice).encode())
    sources=['agent_run.py','agent_advice.py','POLICY.md','SKILL.md','serena-context.yml','versions.json']
    for name in sources:plan.add(share/name,(SOURCE/name).read_bytes(),owned=True)
    plan.add(share/'pre_tool_guard.py',(SOURCE.parent/'agent-guardrails/pre_tool_guard.py').read_bytes(),owned=True)
    for name in ['agent-run','agent-advice']:
        module=name.replace('-','_')+'.py'
        script='#!/bin/sh\nexec '+shlex.quote(str(python))+' '+shlex.quote(str(share/module))+' "$@"\n'
        plan.add(bin_dir/name,script.encode(),mode=0o700,owned=True)
    # No daemon, dashboard, model call or automatic onboarding. The client activates its exact project.
    state=home/'.local/state/agent-efficiency/serena'
    args=[str(serena),'start-mcp-server','--context',str(share/'serena-context.yml'),
          '--mode','no-onboarding','--mode','no-memories','--enable-web-dashboard','false',
          '--enable-gui-log-window','false','--open-web-dashboard','false','--log-level','WARNING']
    # Runtime state is deliberately separate from reversible installation files.
    # Publish the initial config with a hard link so simultaneous first starts
    # never read a partial file; Serena owns subsequent registry migrations.
    seed='projects: []\nweb_dashboard: false\nweb_dashboard_open_on_launch: false\ngui_log_window: false\nproject_serena_folder_location: '+json.dumps(str(state/'projects/$projectDir'))+'\n'
    script = '#!'+str(python)+'\n'+"""import os, tempfile
from pathlib import Path
state=Path(STATE_LITERAL)
state.mkdir(parents=True, exist_ok=True, mode=0o700)
config=state/'serena_config.yml'
if not config.exists():
    fd, temporary=tempfile.mkstemp(prefix='.seed-',dir=state)
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(SEED_LITERAL);out.flush();os.fsync(out.fileno())
        try: os.link(temporary,config)
        except FileExistsError: pass
    finally: os.unlink(temporary)
os.environ['SERENA_HOME']=str(state)
os.execv(ARGS_LITERAL[0], ARGS_LITERAL + __import__('sys').argv[1:])
""".replace('STATE_LITERAL',repr(str(state))).replace('SEED_LITERAL',repr(seed.encode())).replace('ARGS_LITERAL',repr(args))
    plan.add(bin_dir/'agent-serena-mcp',script.encode(),mode=0o700,owned=True)
    cli_script=script.replace(repr(args),repr([str(serena)]))
    plan.add(bin_dir/'agent-serena',cli_script.encode(),mode=0o700,owned=True)
    for relative in ['.agents/skills/agent-efficiency','.claude/skills/agent-efficiency','.gemini/skills/agent-efficiency','.gemini/antigravity/skills/agent-efficiency']:
        plan.add(home/relative/'SKILL.md',(SOURCE/'SKILL.md').read_bytes(),owned=True)
    # RTK stays the package-managed binary. Record its resolved path without replacing it or existing hooks.
    plan.add(share/'runtime.json',json_bytes(dict(python=str(python),serena=str(serena),rtk=str(rtk))),owned=True)
    return plan


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--home',type=Path,default=Path(os.environ.get('AGENT_EFFICIENCY_HOME',str(Path.home()))))
    parser.add_argument('--python',type=Path,default=Path(sys.executable))
    parser.add_argument('--serena',type=Path,default=Path.home()/'.local/bin/serena')
    parser.add_argument('--rtk',type=Path,default=Path('/opt/homebrew/bin/rtk'))
    action=parser.add_mutually_exclusive_group();action.add_argument('--apply',action='store_true');action.add_argument('--rollback',type=Path)
    args=parser.parse_args()
    try:
        if args.rollback:
            rollback(args.home,args.rollback);print('rollback completed');return
        for path in [args.python,args.serena,args.rtk]:
            if not path.is_file() or not os.access(path,os.X_OK):raise ValueError('missing executable: '+str(path))
        plan=build_plan(args.home,args.python,args.serena,args.rtk)
        changed=plan.changed()
        if args.apply:
            manifest=plan.apply();print(json.dumps(dict(status='installed' if manifest else 'unchanged',changed=len(changed),manifest=str(manifest) if manifest else None)))
        else:print(json.dumps(dict(status='preview',changed=[e['path'] for e in changed]),indent=2))
    except (OSError,ValueError,KeyError,TypeError) as exc:
        print('agent-efficiency: '+str(exc),file=sys.stderr);sys.exit(1)


if __name__=='__main__':main()
