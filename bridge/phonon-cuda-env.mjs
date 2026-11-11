import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A systemd user service does not normally read the shell profile that adds
// rustup and the default CUDA toolkit to PATH. Use only known local locations;
// retain the caller's environment for installations that use other paths.
export function cudaEnvironment(base=process.env,{home=os.homedir(),exists=existsSync}={}) {
  const env={...base};
  const toolkit=[base.CUDA_PATH,base.CUDA_HOME,'/usr/local/cuda'].find(p=>p && exists(path.join(p,'bin','nvcc')));
  const bins=[path.join(home,'.cargo','bin'),toolkit&&path.join(toolkit,'bin')].filter(p=>p&&exists(p));
  env.PATH=[...bins,base.PATH||''].filter(Boolean).join(path.delimiter);
  if(toolkit){
    env.CUDA_PATH=toolkit;
    const libs=[path.join(toolkit,'lib64'),path.join(toolkit,'lib')].filter(exists);
    if(libs.length)env.LD_LIBRARY_PATH=[...libs,base.LD_LIBRARY_PATH||''].filter(Boolean).join(path.delimiter);
  }
  return env;
}
