// Runs the backend and frontend dev servers together with prefixed output.
import { spawn } from 'node:child_process'

const procs = [
  { name: 'backend ', color: '\x1b[36m', cmd: 'npm', args: ['--prefix', 'backend', 'run', 'dev'] },
  { name: 'frontend', color: '\x1b[35m', cmd: 'npm', args: ['--prefix', 'frontend', 'run', 'dev'] },
]

const children = procs.map(({ name, color, cmd, args }) => {
  const child = spawn(cmd, args, { shell: true, stdio: ['inherit', 'pipe', 'pipe'] })
  const pipe = (stream) =>
    stream.on('data', (d) =>
      d
        .toString()
        .split('\n')
        .filter(Boolean)
        .forEach((line) => process.stdout.write(`${color}[${name}]\x1b[0m ${line}\n`)),
    )
  pipe(child.stdout)
  pipe(child.stderr)
  return child
})

const stop = () => {
  children.forEach((c) => c.kill('SIGINT'))
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
