// Test double for renpy-pre.js: same one-command-at-a-time queue and the same btoa() step, but the
// Python executes in tests/renpy/harness.py (real Python semantics, fake Ren'Py store).
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
export function startHarness(env = {}) {
  const child = spawn('python3', ['-I', new URL('./renpy/harness.py', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', line => waiting.shift()?.(JSON.parse(line)));
  const send = message => new Promise(resolve => { waiting.push(resolve); child.stdin.write(JSON.stringify(message) + '\n'); });
  const queue = []; let current;
  const next = () => {
    if (current || !queue.length) return;
    current = queue.shift();
    const { script, resolve, reject } = current;
    try { btoa(script); } catch (error) { return reject(error); }   // like renpy-pre.js: current stays set -> queue jams
    send({ source: script }).then(reply => {
      current = undefined;
      if (reply.error) reject(Object.assign(new Error(reply.error), { traceback: 'tb' })); else resolve(reply.data);
      next();
    });
  };
  const hooks = { delay: 0, hang: false };
  const renpy_exec = script => new Promise((resolve, reject) => {
    if (hooks.hang) return;   // never settles
    queue.push({ script, resolve: v => setTimeout(() => resolve(v), hooks.delay), reject });
    next();
  });
  return { renpy_exec, evaluate: async expression => (await send({ eval: expression })).data, hooks, close: () => child.kill(),
    jammed: () => current !== undefined };
}
