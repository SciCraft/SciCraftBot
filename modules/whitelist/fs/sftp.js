import fs from 'fs'
import path from 'path'
import {Client} from 'ssh2'
import {readFully} from '../../../utils.js'

export class SFTPFileManager {
    #params

    constructor(params) {
        this.#params = {
            ...params,
            privateKey: params.privateKey && fs.readFileSync(params.privateKey)
        }
    }

    async readFile(file) {
        const fullPath = path.resolve(this.#params.path, file)
        return new Promise((resolve, reject) => {
            const conn = new Client()
            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) return reject(err)
                    readFully(sftp.createReadStream(fullPath, {encoding: 'utf8'})).then(data => {
                        conn.end()
                        resolve(data)
                    }).catch(reject)
                })
            }).connect(this.#params)
        })
    }

    async writeFile(file, data) {
        const fullPath = path.resolve(this.#params.path, file)
        return new Promise((resolve, reject) => {
            const conn = new Client()
            conn.on('ready', () => {
                conn.sftp((err, sftp) => {
                    if (err) return reject(err)
                    const stream = sftp.createWriteStream(fullPath, {encoding: 'utf8'})
                    stream.on('error', reject)
                    stream.end(data, () => {
                        conn.end()
                        resolve()
                    })
                })
            }).connect(this.#params)
        })
    }
}