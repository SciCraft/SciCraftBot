import util from 'minecraft-server-util'

const {RCON} = util

const connections = {}
const TIMEOUT = Symbol()

export async function sendCommands(params, ...commands) {
    const connection = await ensureConnection(params)
    const results = []
    for (const command of commands) {
        results.push(await connection.execute(command))
    }
    return results
}

async function ensureConnection(params) {
    const key = params.host + ':' + params.port
    let connection = connections[key]
    if (!connection) {
        connection = new RCON(params.host, {port: params.port, password: params.password})
        await connection.connect()
        connections[key] = connection
    }
    connection[TIMEOUT] = Math.max(Date.now() + 5000, connection[TIMEOUT] || 0)
    setTimeout(checkRemoveConnection.bind(null, key), 5100)
    return connection
}

async function checkRemoveConnection(key) {
    const connection = connections[key]
    if (connection[TIMEOUT] <= Date.now()) {
        delete connections[key]
        try {
            await connection.close()
        } catch (e) {
            console.error(e)
        }
    }
}