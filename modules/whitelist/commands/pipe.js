import fs from 'fs/promises'

export async function sendCommands(pipe, ...commands) {
    await fs.writeFile(pipe, commands.map(cmd => cmd + '\n').join(), {flag: 'a'})
}