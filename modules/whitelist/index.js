import {Database} from './database.js'
import {getUUID, getUsers} from './usercache.js'
import {sendCommands as rconCommands} from './commands/rcon.js'
import {sendCommands as pipeCommands} from './commands/pipe.js'
import {reformatUUID} from '../../utils.js'
import {SlashCommandBuilder} from '@discordjs/builders'
import {LocalFileManager} from './fs/local.js'
import {FTPFileManager} from './fs/ftp.js'
import {SFTPFileManager} from './fs/sftp.js'

let client, globalConfig, config, database
const servers = {}

export default function(_client, _globalConfig, _config) {
    client = _client
    globalConfig = _globalConfig
    config = _config
    database = new Database('./whitelist.json')

    client.on('interactionCreate', async interaction => {
        if (!interaction.isCommand() || interaction.commandName !== 'whitelist') return
        try {
            await functions[interaction.options.getSubcommand()](interaction)
        } catch (e) {
            console.error(e)
            try {
                await interaction[interaction.deferred ? 'editReply' : 'reply']('An error occured trying to execute this command')
            } catch (_) {}
            try {
                await log(interaction, {
                    title: 'Error while executing command',
                    fields: [{
                        name: '\u200B',
                        value: '```\n' + e.stack + '\n```'
                    }]
                })
            } catch (_) {}
        }
    })

    for (const serverId in config.servers) {
        const server = config.servers[serverId]
        const methods = servers[serverId] = {}
        if (server.pipe) {
            methods.runCommands = pipeCommands.bind(null, server.pipe.path)
        } else if (server.rcon) {
            methods.runCommands = rconCommands.bind(null, server.rcon)
        }
        if (server.local) {
            methods.fs = new LocalFileManager(server.local)
        } else if (server.sftp) {
            methods.fs = new SFTPFileManager(server.sftp)
        } else if (server.ftp) {
            methods.fs = new FTPFileManager(server.ftp)
        }
    }

    client.on('ready', async () => {
        await database.convertNamesToUuids()
        scheduleUpdate()
    })

    client.on('guildMemberUpdate', (oldMember, newMember) => {
        const oldRoles = new Set(oldMember.roles.cache.keys())
        const newRoles = new Set(newMember.roles.cache.keys())
        const allRoles = new Set([...oldRoles, ...newRoles])
        for (const role of allRoles) {
            if (newRoles.has(role) && oldRoles.has(role)) continue
            if (role in config.roles) {
                console.log(`Role update: ${role}, scheduling whitelist update`)
                scheduleUpdate()
                break
            }
        }
    })

    return [new SlashCommandBuilder()
      .setName('whitelist')
      .setDescription('Manages the whitelists')
      .addSubcommand(sub => sub
        .setName('add')  
        .setDescription('Add yourself (or another user) to the whitelist')
        .addStringOption(option => option.setName('name').setDescription('The Minecraft username').setRequired(true))
        .addUserOption(option => option.setName('user').setDescription('The Discord user'))
      )
      .addSubcommand(sub => sub
        .setName('remove')
        .setDescription('Remove one or all linked Minecraft accounts')
        .addStringOption(option => option.setName('name').setDescription('The Minecraft username'))
        .addStringOption(option => option.setName('uuid').setDescription('The Minecraft UUID'))
        .addUserOption(option => option.setName('user').setDescription('The Discord user'))
      )
      .addSubcommand(sub => sub
        .setName('info')
        .setDescription('Get info about a whitelisted user')
        .addStringOption(option => option.setName('name').setDescription('The Minecraft username'))
        .addStringOption(option => option.setName('uuid').setDescription('The Minecraft UUID'))
        .addUserOption(option => option.setName('user').setDescription('The Discord user'))
      )
      .addSubcommand(sub => sub
        .setName('dump')
        .setDescription('Dump the whitelist state as human readable json')
      )
      .addSubcommand(sub => sub
        .setName('reload')
        .setDescription('Reload the whitelist database')
      )
    ]
}

function escapeName(name) {
    return name.replace(/_/g, '\\_')
}

const functions = {
    async add(interaction) {
        const target = interaction.options.getUser('user') || interaction.user
        if (!(await canModify(interaction.user, target))) {
            await interaction.reply({content: 'You\'re not allowed to modify the whitelist settings for ' + target.username, ephemeral: true})
            return
        }
        const minecraftName = interaction.options.getString('name')
        await interaction.deferReply({ephemeral: true})
        const uuid = await getUUID(minecraftName)
        if (!uuid) {
            await interaction.editReply('Cannot find a Minecraft player by that name')
            return
        }
        const current = database.getUser(target.id)
        if (current.uuids.includes(uuid)) {
            await interaction.editReply(`${escapeName(minecraftName)} (${uuid}) is already added to this user`)
            return
        }
        const otherLink = database.getLinkedUser(uuid)
        if (otherLink) {
            await interaction.editReply(`${escapeName(minecraftName)} (${uuid}) is already linked to another user`)
            return
        }
        const allowedCount = await allowedLinks(await getMember(target))
        if (current.uuids.length + 1 > allowedCount) {
            await interaction.editReply(`This account is only allowed ${allowedCount} linked minecraft account${allowedCount === 1 ? '' : 's'}`)
            return
        }
        const linked = database.linkUser(target.id, uuid)
        scheduleUpdate()
        const embed = await makeEmbed(target.id, linked)
        await interaction.editReply({embeds: [embed]})
        await log(interaction, embed)
    },

    async remove(interaction) {
        const {error, target, uuid} = await getTargetedUser(interaction, true)
        if (error) return
        if (!interaction.deferred) await interaction.deferReply({ephemeral: true})
        if (!target || !database.getUser(target.id).uuids.length) {
            await interaction.editReply('Unknown user')
            return
        }
        if (!(await canModify(interaction.user, target))) {
            await interaction.editReply('You\'re not allowed to modify the whitelist settings for ' + target.username)
            return
        }
        if (uuid) {
            const linked = database.unlinkUser(target.id, uuid)
            scheduleUpdate()
            const embed = await makeEmbed(target.id, linked)
            await interaction.editReply({embeds: [embed]})
            await log(interaction, embed)
        } else {
            database.removeUser(target.id)
            scheduleUpdate()
            await interaction.editReply('Removed all linked accounts for <@' + target.id + '>')
            await log(interaction)
        }
    },

    async info(interaction) {
        const {error, target, uuid} = await getTargetedUser(interaction)
        if (error) return
        const info = uuid ? database.getLinkedUser(uuid) : {id: target.id, user: database.getUser(target.id)}
        if (!info || !info.user.uuids.length) {
            await interaction.editReply('Unknown user')
            return
        }
        const embed = await makeEmbed(info.id, info.user)
        await interaction.editReply({embeds: [embed]})
    },

    async dump(interaction) {
        if (!isAdmin(interaction.member)) {
            await interaction.reply({content: 'You do not have permission to use this command.', ephemeral: true})
            return
        }
        await interaction.deferReply({ephemeral: true})
        const {serversForId, names, byUuid, members} = await calculateState()
        const banned = database.getBannedUUIDs()
        const users = {}
        for (const uuid in byUuid) {
            const id = byUuid[uuid]
            const member = members[id]
            const user = users[id] = users[id] || {}
            if (member) user.discord = member.user.tag
            if (banned.has(uuid)) user.banned = true
            user.uuids = user.uuids || {}
            user.uuids[uuid] = names[uuid]
            if (id in serversForId) user.servers = [...serversForId[id]]
        }
        const removed = {}
        for (const uuid of database.removed) {
            removed[uuid] = names[uuid]
        }
        const json = JSON.stringify({users, removed}, null, 2)
        interaction.editReply({
            files: [{
                attachment: Buffer.from(json, 'utf8'),
                name: 'dump.json'
            }],
            ephemeral: true
        })
    },

    async reload(interaction) {
        if (!isAdmin(interaction.member)) {
            await interaction.reply({content: 'You do not have permission to use this command.', ephemeral: true})
            return
        }
        await interaction.deferReply({ephemeral: true})
        try {
            database.load()
            await database.convertNamesToUuids()
            await scheduleUpdate()
            await interaction.editReply({content: 'Database reloaded', ephemeral: true})
        } finally {
            await log(interaction)
        }
    }
}

async function canModify(user, other) {
    if (user.id === other.id) return true
    const guild = await client.guilds.fetch(globalConfig.guild)
    const member = await guild.members.fetch(user)
    const otherMember = await guild.members.fetch(other)
    const manageRoles = member.permissions.has('MANAGE_ROLES', true)
    const higherRole = member.roles.highest.comparePositionTo(otherMember.roles.highest) > 0
    return manageRoles && higherRole
}

async function log(interaction, embed) {
    if (!config.log) return
    let command = interaction.commandName
    for (const data of interaction.options.data) {
        if (data.type === 1) {
            command += ` ${data.name}`
            for (const opt of data.options) {
                command += ` ${opt.name}:${opt.value}`
            }
        }
    }
    const channel = await client.channels.fetch(config.log)
    await channel.send({
        content: interaction.user.tag + ': `/' + command + '`',
        embeds: embed ? [embed] : undefined
    })
}

async function isAdmin(member) {
    return member.permissions.has('Administrator')
}

async function getMember(user) {
    const guild = await client.guilds.fetch(globalConfig.guild)
    return guild.members.fetch(user)
}

async function getMembers(users) {
    const guild = await client.guilds.fetch(globalConfig.guild)
    const members = {}
    const ps = []
    for (let i = 0; i < users.length; i += 100) {
        ps.push(guild.members.fetch({user: users.slice(i, Math.max(i + 100, users.length))}).then(m => {
            for (const id of m.keys()) members[id] = m.get(id)
        }))
    }
    await Promise.all(ps)
    return members
}

async function allowedLinks(member) {
    let allowed = 0
    for (const role in config.roles) {
        if (!member.roles.cache.has(role)) continue
        allowed = Math.max(allowed, config.roles[role].allowedLinks)
    }
    return allowed
}

async function getTargetedUser(interaction, requireArgument = false) {
    let uuid = interaction.options.getString('uuid')
    const name = interaction.options.getString('name')
    let target = interaction.options.getUser('user')
    if ((uuid && name) || (uuid && target) || (name && target)) {
        await interaction.reply({content: 'At most one of `uuid`, `name` and `user` expected', ephemeral: true})
        return {error: true}
    }
    await interaction.deferReply()
    if (name) {
        uuid = await getUUID(name)
        if (!uuid) {
            await interaction.editReply('Cannot find a Minecraft player by that name')
            return {error: true}
        }
    }
    if (uuid) {
        uuid = reformatUUID(uuid)
        const linkedUser = database.getLinkedUser(uuid)
        if (linkedUser) {
            target = await client.users.fetch(linkedUser.id)
        }
    } else if (!requireArgument) {
        target = target || interaction.user
    }
    if (requireArgument && !target && !uuid) {
        await interaction.reply({content: 'One of `uuid`, `name` and `user` expected', ephemeral: true})
        return {error: true}
    }
    return {error: false, uuid, name, target}
}

async function makeEmbed(id, userInfo) {
    const user = await client.users.fetch(id)
    const member = await getMember(user)
    const users = await getUsers(userInfo.uuids)
    const limit = await allowedLinks(member)
    const servers = getServersForMember(member) || []
    return {
        title: user.username,
        fields: [{
            name: `Username${userInfo.uuids.length === 1 ? '' : 's'} (${users.length}/${isFinite(limit) ? limit : 'unlimited'})`,
            value: users.map(u => `${escapeName(u.name)} \`${u.uuid}\``).join(',\n') || 'None'
        }, {
            name: 'Servers',
            value: [...servers].join('\n') || 'None'
        }],
        footer: {
            text: user.tag,
            icon_url: user.displayAvatarURL()
        }
    }
}

function createQueue(callback, interval) {
    let running = false
    let done
    let promise = new Promise(resolve => done = resolve)
    function schedule() {
        setTimeout(async () => {
            if (running) {
                console.log('Already updating, rescheduling')
                schedule()
                return
            }
            running = true
            try {
                await callback()
                done()
                promise = new Promise(resolve => done = resolve)
            } catch (e) {
                console.error(e)
            } finally {
                running = false
            }
        }, interval)
        return promise
    }
    return schedule
}

const scheduleUpdate = createQueue(update, 5000)

function getServersForRole(roleId) {
    return config.roles[roleId].servers.flatMap(glob => {
        if (!glob.startsWith('*.')) return [glob]
        return Object.keys(servers).filter(id => id.endsWith(glob.slice(2)))
    })
}

function getServersForMember(member) {
    const serverIds = []
    for (const roleId in config.roles) {
        if (member.roles.cache.has(roleId)) {
            serverIds.push(...getServersForRole(roleId))
        }
    }
    return new Set(serverIds)
}

async function calculateState() {
    const byUuid = database.getAllByUUID()
    const names = {}
    for (const {uuid, name} of await getUsers(Object.keys(byUuid))) {
        names[uuid] = name
    }
    const ids = new Set(Object.values(byUuid))
    const members = await getMembers([...ids])
    const serversForId = {}
    for (const member of Object.values(members)) {
        serversForId[member.id] = getServersForMember(member)
    }
    const serversForUuid = {}
    for (const uuid of database.removed) {
        serversForUuid[uuid] = new Set()
    }
    for (const uuid in byUuid) {
        const serversForThisUuid = serversForId[byUuid[uuid]]
        if (!serversForThisUuid) {
            console.warn(`Could not find servers for ${uuid} (${byUuid[uuid]})`)
            continue
        }
        serversForUuid[uuid] = serversForThisUuid
    }
    for (const uuid of database.getBannedUUIDs()) {
        serversForUuid[uuid] = new Set()
    }
    return {serversForUuid, serversForId, names, members, byUuid}
}

async function update() {
    console.log('Updating whitelist...')
    const start = Date.now()
    const {serversForUuid, names} = await calculateState()
    const allUpdates = {}
    for (const serverId in servers) {
        console.log(`Updating ${serverId}...`)
        try {
            const server = servers[serverId]
            const currentWhitelist = JSON.parse(await server.fs.readFile('whitelist.json'))
            const alreadyPresent = new Set()
            const newWhitelist = []
            const unmanaged = []
            const additions = []
            const removals = []
            for (const entry of currentWhitelist) {
                if (!(entry.uuid in serversForUuid)) {
                    unmanaged.push(entry)
                    newWhitelist.push(entry)
                } else {
                    const allowedServers = serversForUuid[entry.uuid]
                    if (allowedServers.has(serverId)) {
                        alreadyPresent.add(entry.uuid)
                        newWhitelist.push(entry)
                    } else {
                        removals.push(entry.uuid)
                    }
                }
            }
            for (const uuid in serversForUuid) {
                if (alreadyPresent.has(uuid) || !serversForUuid[uuid].has(serverId)) continue
                newWhitelist.push({uuid, name: names[uuid]})
                additions.push(uuid)
            }
            if (additions.length || removals.length) {
                allUpdates[serverId] = {additions, removals}
                await server.fs.writeFile('whitelist.json', JSON.stringify(newWhitelist, null, 2))
                const commands = []
                for (const uuid of removals) {
                    commands.push('deop ' + names[uuid])
                    commands.push('kick ' + names[uuid])
                }
                if (config.servers[serverId].opEveryone) {
                    for (const uuid of additions) commands.push('op ' + names[uuid])
                }
                commands.push('whitelist reload')
                    await server.runCommands(...commands)
            }
        } catch (e) {
            console.error(`Could not update ${serverId}: ${e}`)
        }
    }
    if (allUpdates.length) {
        console.log(allUpdates)
    }
    console.log(`Done in ${Date.now() - start}ms`)
}