import fs from 'fs/promises'
import path from 'path'

export class LocalFileManager {
    #path

    constructor(params) {
        this.#path = params.path
    }

    async readFile(file) {
        return fs.readFile(path.resolve(this.#path, file))
    }

    async writeFile(file, data) {
        return fs.writeFile(path.resolve(this.#path, file), data)
    }
}