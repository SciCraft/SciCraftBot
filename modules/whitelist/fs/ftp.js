import path from 'path'
import Client from 'ftp'
import {readFully} from '../../../utils.js'

export class FTPFileManager {
    #params

    constructor(params) {
        this.#params = params
    }

    async #connect() {
        return new Promise((resolve, reject) => {
            const c = new Client()
            c.on('ready', () => resolve(c))
            c.on('error', reject)
            c.connect({
                host: this.#params.host,
                port: this.#params.port || 21,
                user: this.#params.username,
                password: this.#params.password
            })
        })
    }

    async readFile(file) {
        const c = await this.#connect()
        return new Promise((resolve, reject) => {
            c.get(path.resolve('/', this.#params.path, file), async (err, stream) => {
                if (err) {
                    reject(err)
                    return
                }
                const data = await readFully(stream)
                c.end()
                resolve(data)
            })
        })
    }

    async writeFile(file, data) {
        const c = await this.#connect()
        return new Promise((resolve, reject) => {
            c.put(data, path.resolve('/', this.#params.path, file), err => {
                if (err) {
                    reject(err)
                } else {
                    resolve()
                }
            })
        })
    }
}