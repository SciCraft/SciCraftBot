import request from 'request-promise-native'

let client, config, globalConfig
const twitchAuth = {id: null, secret: null}
const streamMessages = new Set()

export default (_client, _globalConfig, _config) => {
  client = _client
  config = _config
  globalConfig = _globalConfig
  if (config['cleanup-streams']) {
    const cleanupConf = config['cleanup-streams']
    const channels = cleanupConf.channels || []
    client.on('messageCreate', msg => {
      if (channels.includes(msg.channel.id)) checkCleanup(msg)
    })
    if (cleanupConf.twitchApiClientId && cleanupConf.twitchApiClientSecret) {
      twitchAuth.id = cleanupConf.twitchApiClientId
      twitchAuth.secret = cleanupConf.twitchApiClientSecret
      setInterval(async () => {
        try {
          await checkStreams(cleanupConf.gracePeriod || (10 * 60))
        } catch (e) {
          console.error(e)
        }
      }, 30e3)
    }
  }
  if (config['media-only']) {
    const mediaOnlyConf = config['media-only']
    const ignoreRoles = mediaOnlyConf['ignore-roles'] || []
    const ignorePermissions = mediaOnlyConf['ignore-permissions'] || ['ManageChannels']
    const channels = mediaOnlyConf.channels || []
    client.on('messageCreate', msg => {
      if (msg.author.bot || !channels.includes(msg.channel.id) || !msg.deletable || !msg.member || /\bhttp(s)?:\/\//.test(msg.content) || msg.embeds.length || msg.attachments.size) return
      for (const [id, role] of msg.member.roles.cache) {
        if (ignoreRoles.includes(id)) {
          console.log(`${msg.id}: ${msg.author.username} has ${role.name}, not deleting`)
          return
        }
      }
      for (const perm of ignorePermissions) {
        if (msg.member.permissions.has(perm)) {
          console.log(`${msg.id}: ${msg.author.username} has ${perm}, not deleting`)
          return
        }
      }
      deleteAndLog(msg, 'Text message in media-only channel')
    })
  }
}

function checkCleanup (msg) {
  if (!msg.deletable || !/\btwitch\.tv\//.test(msg.content)) return
  const match = msg.content.match(/\b(clips\.)?twitch\.tv\/(.+?)\b/)
  if (!match || match[1]) return
  if (match[2] === 'videos') return // Highlights & VODs
  console.log(`Picked up message ${msg.id} linking to ${match[0]} (user ${match[2]})`)
  streamMessages.add({
    message: msg,
    twitchUser: match[2]
  })
}

async function checkStreams (gracePeriod) {
  const users = [...new Set([...streamMessages].map(m => m.twitchUser))]
  if (!users.length) return
  const streams = await getTwitchApi('streams', {first: 100, user_login: users})
  const online = streams.filter(s => s.type === 'live').map(s => s.user_name.toLowerCase())
  for (const msg of streamMessages) {
    if (online.includes(msg.twitchUser.toLowerCase())) continue
    if (Date.now() - msg.message.createdTimestamp < gracePeriod * 1000) {
      if (!msg.loggedGrace) {
        console.log(msg.message.id + ' is in grace period')
        msg.loggedGrace = true
      }
      continue
    }
    try {
      await deleteAndLog(msg.message, 'Stream offline')
    } catch (e) {
      console.error('Could not delete message ' + msg.message.id)
      console.error(e)
    }
    streamMessages.delete(msg)
  }
}

async function deleteAndLog (msg, reason) {
  await msg.delete({reason})
  if (globalConfig.modlog) {
    const modlog = await client.channels.fetch(globalConfig.modlog)
    await modlog.send({
      embeds: [{
        author: {
          name: msg.author.tag,
          icon_url: msg.author.displayAvatarURL()
        },
        description: `**Message by <@${msg.author.id}> deleted in <#${msg.channel.id}>**\n${msg.content}`,
        fields: [{
          name: 'Reason',
          value: reason
        }],
        footer: {
          text: 'ID: ' + msg.id
        },
        timestamp: new Date(msg.createdTimestamp)
      }]
    })
  }
}

let oauthToken, oauthExpires
async function getTwitchOauthToken () {
  if (oauthToken && Date.now() < oauthExpires) return oauthToken
  console.log('Fetching new Twitch OAuth token')
  const data = JSON.parse(await request({
    url: 'https://id.twitch.tv/oauth2/token',
    qs: {client_id: twitchAuth.id, client_secret: twitchAuth.secret, grant_type: 'client_credentials'},
    method: 'POST'
  }))
  oauthToken = data.access_token
  oauthExpires = Date.now() + (data.expires_in - 20) * 1000
  return oauthToken
}

async function getTwitchApi (path, params) {
  const token = await getTwitchOauthToken()
  const r = () => request({
    url: 'https://api.twitch.tv/helix/' + path,
    qs: params,
    qsStringifyOptions: {arrayFormat: 'repeat'},
    headers: {
      'Client-ID': twitchAuth.id,
      'Authorization': 'Bearer ' + token
    }
  })
  let res = JSON.parse(await r())
  const data = res.data
  while (res.data.length && res.pagination && res.pagination.cursor && res.pagination.cursor !== 'IA') {
    params.after = res.pagination.cursor
    res = JSON.parse(await r())
    data.push(...res.data)
  }
  return data
}
