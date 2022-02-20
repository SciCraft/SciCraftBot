import fs from 'fs'
import fetch from 'node-fetch'
import {reformatUUID} from '../../utils.js'

const FILE = './usercache.json'
const CACHE_TIMEOUT = 86400e3

let cache = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {}

export async function getUUID(username) {
    if (!Array.isArray(username)) {
        return getUUIDIfCached(username) || lookupUUID(username)
    }
    const results = {}
    const missing = []
    for (const name of username) {
        const cached = getUUIDIfCached(name)
        if (cached) {
            results[name.toLowerCase()] = cached
        } else {
            missing.push(name)
        }
    }
    const ps = []
    for (let i = 0; i < missing.length; i+= 10) {
        ps.push(lookupUUID(missing.slice(i, Math.min(i + 10, missing.length))))
    }
    const objs = await Promise.all(ps)
    for (const obj of objs) {
        Object.assign(results, obj)
    }
    return results
}

function getUUIDIfCached(username) {
    const lc = username.toLowerCase()
    if (cache[lc] && new Date(cache[lc].expires) > new Date()) {
        return cache[lc].uuid
    }
    return null
}

export async function getUsers(uuids) {
    const cached = new Set(Object.values(cache).map(u => u.uuid))
    const missing = uuids.filter(uuid => !cached.has(uuid))
    if (missing.length) {
        await lookupNames(missing)
    }
    return Object.values(cache).filter(u => uuids.includes(u.uuid))
}

async function lookupUUID(username) {
    try {
        console.log(`Fetching ${username}`)
        const res = await fetch('https://api.mojang.com/profiles/minecraft', {
            method: 'POST',
            body: JSON.stringify(Array.isArray(username) ? username : [username]),
            headers: {'content-type': 'application/json'}
        })
        const data = await res.json()
        const results = {}
        for (const userData of data) {
            const uuid = reformatUUID(userData.id)
            cache[userData.name.toLowerCase()] = {name: userData.name, uuid, expires: new Date(Date.now() + CACHE_TIMEOUT)}
            results[userData.name.toLowerCase()] = uuid
        }
        console.log(results)
        fs.writeFileSync(FILE, JSON.stringify(cache, null, 2))
        return Array.isArray(username) ? results : results[username]
    } catch (e) {
        console.error(e)
        throw Error('Cannot lookup uuid for username ' + username)
    }
}

async function lookupNames(uuids) {
    await Promise.all(uuids.map(uuid => lookupName(uuid, false)))
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2))
}

async function lookupName(uuid, writeCache = true) {
    try {
        console.log(`Fetching ${uuid}`)
        const res = await fetch(`https://api.mojang.com/user/profiles/${uuid}/names`)
        const data = await res.json()
        if (!data.length) throw 'Empty result from Mojang API'
        const name = data[data.length - 1].name
        cache[name.toLowerCase()] = {name, uuid, expires: new Date(Date.now() + CACHE_TIMEOUT)}
        if (writeCache) fs.writeFileSync(FILE, JSON.stringify(cache, null, 2))
        return name
    } catch (e) {
        console.error(e)
        throw Error('Cannot lookup username for uuid ' + uuid)
    }
}