import fs, { read } from 'fs'
import { getUUID } from './usercache.js'

export class Database {
    #file
    #users = {}
    #removed = new Set()

    constructor(file) {
        this.#file = file
        this.load()
        this.save()
    }

    load() {
        if (!fs.existsSync(this.#file)) return
        const data = JSON.parse(fs.readFileSync(this.#file))
        this.#users = data.users
        for (const user in this.#users) {
            this.#users[user].uuids = this.#users[user].uuids || []
        }
        this.#removed = new Set(data.removed || [])
    }

    save() {
        fs.writeFileSync(this.#file, JSON.stringify(this.dump(), null, 2))
    }

    dump() {
        return {
            users: this.#users,
            removed: [...this.#removed]
        }
    }

    async convertNamesToUuids() {
        const names = new Set()
        for (const user in this.#users) {
            for (const name of this.#users[user].names || []) {
                names.add(name)
            }
        }
        if (!names.size) return false
        const uuids = await getUUID([...names])
        for (const user in this.#users) {
            const userUuids = new Set(this.#users[user].uuids)
            for (const name of this.#users[user].names || []) {
                const uuidForName = uuids[name.toLowerCase()]
                if (!uuidForName) {
                    console.warn('Invalid username ' + name + ', skipping')
                } else {
                    userUuids.add(uuidForName)
                }
            }
            this.#users[user].uuids = [...userUuids]
            delete this.#users[user].names
        }
        for (const name in uuids) this.#removed.delete(uuids[name])
        this.save()
        return true
    }

    getUser(id) {
        return this.#users[id] || {uuids: []}
    }

    getAllByUUID() {
        const byUuid = {}
        for (const id in this.#users) {
            for (const uuid of this.#users[id].uuids) {
                byUuid[uuid] = id
            }
        }
        return byUuid
    }

    getBannedUUIDs() {
        const banned = new Set()
        for (const user of Object.values(this.#users)) {
            if (!user.banned) continue
            for (const uuid of user.uuids) {
                banned.add(uuid)
            }
        }
        return banned
    }

    getLinkedUser(uuid) {
        for (const id in this.#users) {
            if (this.#users[id].uuids.includes(uuid)) return {id, user: this.#users[id]}
        }
    }

    linkUser(id, uuid) {
        const user = this.getUser(id)
        user.uuids = [...new Set([...user.uuids, uuid])]
        this.#users[id] = user
        this.#removed.delete(uuid)
        this.save()
        return user
    }

    unlinkUser(id, uuid) {
        const user = this.getUser(id)
        const uuids = new Set(user.uuids)
        uuids.delete(uuid)
        user.uuids = [...uuids]
        if (user.uuids.length) {
            this.#users[id] = user
        } else {
            delete this.#users[id]
        }
        this.#removed.add(uuid)
        this.save()
        return user
    }

    removeUser(id) {
        const user = this.#users[id]
        delete this.#users[id]
        for (const uuid of user.uuids) {
            this.#removed.add(uuid)
        }
        this.save()
        return user
    }

    get removed() {
        return [...this.#removed]
    }
}