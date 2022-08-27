import fs from 'fs/promises'

export async function sendCommands(pipe, ...commands) {
    const controller = new AbortController()
    const timeout = setTimeout(controller.abort, 5000)
    await fs.writeFile(pipe, commands.map(cmd => cmd + '\n').join(''), {flag: 'a', signal: controller.signal})
    clearTimeout(timeout)
}