import { test, expect } from 'bun:test';
import { mkdtempSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { castyCommand, chooseFrontend } from '../index.js';
import { runtimeDirectory } from '../lib/runtime.js';
import { version } from '../package.json';
const entry = Bun.fileURLToPath(new URL('../index.js', import.meta.url));
const engine = Bun.fileURLToPath(new URL('../compositor.js', import.meta.url));

test('launcher preserves browser frontend and package runner selection', () => {
  expect(chooseFrontend([])).toEqual({ frontend: 'casty', args: [] });
  expect(chooseFrontend(['--casty', '--help']).args).toEqual(['--help']);
  expect(chooseFrontend(['--headless', '--socket=test'])).toEqual({ frontend: 'headless', args: ['--socket=test'] });
  const args = ['about:blank', '--', '--socket=test'];
  const which = names => name => names.includes(name) ? `/bin/${name}` : null;
  expect(castyCommand(args, which(['npx','bun','bunx']))).toEqual(['/bin/npx','--loglevel=error','-p','@drxiaozhi/casty','--','casty',...args]);
  expect(castyCommand(args, which(['npx','bunx']))).toEqual(['/bin/bunx','@drxiaozhi/casty',...args]);
  expect(castyCommand(args, which(['bun']))).toEqual(['/bin/bun','x','@drxiaozhi/casty',...args]);
  expect(castyCommand(args, which([]))).toEqual([process.argv0,'x','@drxiaozhi/casty',...args]);
});

test('default executable forwards CASTY_BROWSER and arguments without downloading', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'buninu-land-launch-'));
  const output = join(directory, 'result.json');
  const recorder = `#!${process.execPath}\nawait Bun.write(process.env.LAUNCH_RESULT, JSON.stringify({args:Bun.argv.slice(2),engine:process.env.CASTY_BROWSER}));\n`;
  for (const name of ['npx','bun']) { await Bun.write(join(directory,name),recorder); chmodSync(join(directory,name),0o755); }
  const child = Bun.spawn([process.execPath,entry,'about:blank','--','--socket=test'], {env:{...process.env,PATH:directory,LAUNCH_RESULT:output},stdout:'pipe',stderr:'pipe'});
  expect(await child.exited).toBe(0);
  expect(await Bun.file(output).json()).toEqual({args:['--loglevel=error','-p','@drxiaozhi/casty','--','casty','about:blank','--','--socket=test'],engine});
});

test('help/version aliases, native placeholders, and headless forwarding', async () => {
  for (const path of [entry,engine]) for (const flag of ['--help','-h','--version','-V']) {
    const child=Bun.spawn([process.execPath,path,flag],{stdout:'pipe',stderr:'pipe'});
    expect(await child.exited).toBe(0); expect(await new Response(child.stdout).text()).toContain('buninu-land');
  }
  for (const frontend of ['--win32','--gtk','--appkit','--qt']) {
    const child=Bun.spawn([process.execPath,entry,frontend],{stdout:'pipe',stderr:'pipe'});
    expect(await child.exited).toBe(2); expect(await new Response(child.stderr).text()).toContain('not implemented');
  }
  const child=Bun.spawn([process.execPath,entry,'--headless','-V'],{stdout:'pipe',stderr:'pipe'});
  expect(await child.exited).toBe(0);expect(await new Response(child.stdout).text()).toContain(`buninu-land ${version}`);
});

test('socket directory uses explicit XDG, then TMPDIR', () => {
  expect(runtimeDirectory({XDG_RUNTIME_DIR:'/tmp/xdg',TMPDIR:'/tmp/temp'})).toBe('/tmp/xdg');
  expect(runtimeDirectory({TMPDIR:'/tmp/temp'})).toBe('/tmp/temp');
  expect(() => runtimeDirectory({XDG_RUNTIME_DIR:'relative',TMPDIR:'/tmp'})).toThrow('absolute');
  expect(() => runtimeDirectory({TMPDIR:'relative'})).toThrow('absolute');
});
