#!/usr/bin/env python3
"""Bundle local device helpers and Homebrew dylibs with relative loader paths."""
from pathlib import Path
import subprocess, shutil
root=Path(__file__).resolve().parent.parent
out=root/'src-tauri/helpers';lib=out/'lib';lib.mkdir(parents=True,exist_ok=True)
inputs=[root/'.tools/src/idevicerestore/src/idevicerestore',Path('/opt/homebrew/bin/irecovery'),Path('/opt/homebrew/bin/ideviceinfo'),Path('/opt/homebrew/bin/ideviceenterrecovery')]
queue=[];seen={}
for source in inputs:
 dest=out/source.name;shutil.copy2(source,dest);queue.append((source.resolve(),dest))
for source,dest in queue:
 subprocess.run(['chmod','u+w',str(dest)],check=True)
 deps=subprocess.check_output(['otool','-L',str(source)],text=True).splitlines()[1:]
 for row in deps:
  dep=row.strip().split(' (')[0]
  if not dep.startswith('/opt/homebrew/'):continue
  resolved=Path(dep).resolve()
  if resolved==source:continue
  name=Path(dep).name
  if name in seen and seen[name]!=resolved:raise RuntimeError(f'Conflicting dylib names: {name}')
  if name not in seen:
   seen[name]=resolved;target=lib/name;shutil.copy2(resolved,target);queue.append((resolved,target))
  relative=('@loader_path/' if dest.parent==lib else '@loader_path/lib/')+name
  subprocess.run(['install_name_tool','-change',dep,relative,str(dest)],check=True)
 if dest.parent==lib:subprocess.run(['install_name_tool','-id','@loader_path/'+dest.name,str(dest)],check=True)
for _,dest in reversed(queue):subprocess.run(['codesign','--force','--sign','-',str(dest)],check=True)
shutil.copy2(root/'.tools/src/idevicerestore/COPYING',out/'idevicerestore-COPYING')
print(f'Bundled {len(inputs)} helpers and {len(seen)} dylibs')
