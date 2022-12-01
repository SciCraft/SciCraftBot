import fs from 'fs/promises'

export async function sendCommands(pipe, ...commands) {
    const controller = new AbortController()
    let done, fail
    const timeout = setTimeout(() => {
        controller.abort()
        fail('Timed out')
    }, 5000)
    // Node.js only checks the abort signal before chunks are written, so it's mostly useless for pipes where write() blocks
    fs.writeFile(pipe, commands.map(cmd => cmd + '\n').join(''), {flag: 'a', signal: controller.signal}).then(() => {
        clearTimeout(timeout)
        done()
    }).catch(fail)
    return new Promise((resolve, reject) => {
        done = resolve
        fail = reject
    })
}