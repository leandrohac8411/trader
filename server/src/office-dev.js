// Dedicated local preview: dotenv cannot override this explicit process environment.
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--watch', 'src/index.js'], {
  stdio:'inherit', env:{ ...process.env, DEMO_BOT:'0' }, windowsHide:true,
});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code ?? 0;});
