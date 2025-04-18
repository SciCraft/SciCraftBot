import https from 'https'
import request from 'request-promise-native'
import fetch from 'node-fetch'
import html from 'html-entities'
import {SlashCommandBuilder} from '@discordjs/builders'
import {replyNoMention} from '../../utils.js'

let client, config

export default async (_client, _globalConfig, _config) => {
  client = _client
  config = _config
  if (!config) return
  const state = {}
  await poll.call(state)
  if (config.webhook || config.channels) {
    setInterval(poll.bind(state), (config.interval || 2) * 1000)
  }
  async function handleVersionCommand(interaction, versionArg) {
    let type = 'snapshot'
    let id
    if (versionArg) {
      if (Object.keys(state.data.latest).includes(versionArg)) {
        type = versionArg
      } else {
        id = versionArg
      }
    }
    if (!id) id = state.data.latest[type]
    const version = state.data.versions.find(v => v.id === id)
    if (version) {
      const embed = await getUpdateEmbed(version)
      await replyNoMention(interaction, {embeds: [embed]})
    } else {
      await replyNoMention(interaction, `Unknown version '${id || type}'`)
    }
  }
  client.on('messageCreate', async message => {
    if (message.author.bot) return
    try {
      if (message.content.startsWith(_globalConfig.prefix + 'mcversion')) {
        await handleVersionCommand(message, message.content.substr(10).trim())
      }
    } catch (e) {
      console.error(e)
    }
  })
  client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand() || interaction.commandName !== 'mcversion') return
    await interaction.deferReply()
    await handleVersionCommand(interaction, interaction.options.getString('version'))
  })
  return [
    new SlashCommandBuilder()
      .setName('mcversion')
      .setDescription('Shows information about Minecraft versions')
      .addStringOption(option => option.setName('version').setDescription('A specific version'))
  ]
}

const agent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 10000
})

async function fetchManifest(lastModified) {
  const headers = {}
  if (lastModified) {
    headers['If-Modified-Since'] = lastModified.toUTCString()
  }
  try {
    return await fetch('https://meta.skyrising.xyz/mc/game/version_manifest.json', {timeout: 4000, headers, agent})
  } catch (e) {
    console.error(e.message)
    return await fetch('https://piston-meta.mojang.com/mc/game/version_manifest.json', {timeout: 4000, agent})
  }
}

async function poll() {
  try {
    const res = await fetchManifest(this.lastModified)
    const lastModifiedStr = res.headers.get('Last-Modified')
    if (lastModifiedStr) {
      const lastModified = new Date(lastModifiedStr)
      if (isFinite(lastModified.getTime())) {
        this.lastModified = lastModified
      }
    }
    if (res.status === 304) return
    const data = await res.json()
    this.data = data
    const latestDate = Math.max(...data.versions.map(v => Date.parse(v.time)))
    if (this.latestDate === undefined) {
      this.latestRelease = data.latest.release
      this.latestSnapshot = data.latest.snapshot
      this.latestDate = latestDate
      return
    }
    if (latestDate < this.latestDate) return
    this.latestDate = latestDate
    if (this.latestRelease !== data.latest.release) {
      this.latestRelease = data.latest.release
      this.latestSnapshot = data.latest.snapshot
      await update(data.versions.find(v => v.id === data.latest.release))
    } else if (this.latestSnapshot !== data.latest.snapshot) {
      this.latestSnapshot = data.latest.snapshot
      await update(data.versions.find(v => v.id === data.latest.snapshot))
    }
  } catch (e) {
    console.error(e)
  }
}

const fancySize = size => {
  const mbs = size / (1024 * 1204)
  return mbs.toFixed(1) + 'MB'
}

async function update(version) {
  const embed = await getUpdateEmbed(version)
  if (config.webhook) await request.post(config.webhook, {json: {embeds: [embed]}})
  if (config.channels) {
    for (const id of config.channels) {
      const channel = await client.channels.fetch(id)
      await channel.send({embeds: [embed]})
    }
  }
}

async function getUpdateEmbed(version) {
  const details = await (await fetch(version.url)).json()
  const fields = {
    Type: version.type.includes('_') ? version.type.replace(/_/g, '-') : version.type[0].toUpperCase() + version.type.slice(1),
    Id: version.id,
    'Version JSON': `[${version.id}.json](${version.url})`,
    Assets: `[${details.assetIndex.id}](${details.assetIndex.url})`
  }
  let embedImage, embedThumbnail
  let extraDescription
  try {
    const {url, image, subtitle, description} = await getArticle(version)
    extraDescription = description
    if (url) {
      fields.Changelog = `[${subtitle || 'minecraft.net'}](${url})`
    } else {
      fields.Changelog = `[quiltmc.org](https://quiltmc.org/mc-patchnotes/#${version.id})`
    }
    if (image) {
      if (image.endsWith('-header.jpg')) {
        embedImage = {url: image}
      } else {
        embedThumbnail = {url: image}
      }
    }
  } catch (e) {
    console.error(e)
  }
  const jars = [
    details.downloads.server && `[Server JAR](${details.downloads.server.url}) (${fancySize(details.downloads.server.size)})`,
    details.downloads.client && `[Client JAR](${details.downloads.client.url}) (${fancySize(details.downloads.client.size)})`
  ].filter(Boolean).join(' - ')
  const description = [
    Object.keys(fields).map(k => `**${k}**: ${fields[k]}`).join('\n'),
    extraDescription,
    jars
  ].filter(Boolean).join('\n\n')
  const embed = {
    title: `Minecraft ${getFullVersionName(version)}`,
    url: version.url,
    description,
    timestamp: version.releaseTime,
    image: embedImage,
    thumbnail: embedThumbnail
  }
  return embed
}

function getFullVersionName(version) {
  const match = version.id.match(/^(\d+\.\d+(?:\.\d+)?)(-(rc|pre)(\d+)$)?/)
  if (match) {
    switch (match[3]) {
      case 'rc': return match[1] + ' Release Candidate ' + match[4]
      case 'pre': return match[1] + ' Pre-Release ' + match[4]
    }
  }
  return version.type.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') + ' ' + version.id
}

const USER_AGENT = 'Mozilla/5.0 (Linux) Gecko'

async function getPatchNotes() {
  try {
    return await (await fetch('https://launchercontent.mojang.com/javaPatchNotes.json', {timeout: 2000})).json()
  } catch (e) {
    console.error(e)
    return {version: 1, entries: []}
  }
}

async function getPatchNotesInfo(version) {
  const allPatchNotes = await getPatchNotes()
  const patchNotes = allPatchNotes.entries.find(e => e.version === version.id)
  if (!patchNotes) return {}
  const info = {}
  const image = 'https://launchercontent.mojang.com' + patchNotes.image.url
  if (await checkImage(image)) {
    info.image = image
  }
  const match = patchNotes.body.match(/^<p>(.*?)<\/p>/)
  if (match) {
    let h = match[1]
    h = h.replace(/<a.*?href="(.*?)".*?>(.*?)<\/a>/g, "[$2]($1)")
    info.description = html.decode(h)
  }
  return info
}

async function getArticleGrid() {
  try {
    return await (await fetch('https://www.minecraft.net/content/minecraft-net/_jcr_content.articles.grid', {timeout: 2000, headers: {'User-Agent': USER_AGENT}})).json()
  } catch (e) {
    console.error(e)
    return {article_grid: [], article_count: 0}
  }
}

async function getArticleInfo(version) {
  const articles = await getArticleGrid()
  const candidates = articles.article_grid.filter(article => {
    const title = article.default_tile.title
    if (!title.startsWith('Minecraft ') || title.startsWith('Minecraft Dungeons') || article.default_tile.sub_header.includes('Bedrock Beta')) return false
    if (title.includes(version.id)) return true
    if (version.type !== 'snapshot') return false
    const snapshot = version.id.match(/^(\d{2}w\d{2})([a-z])$/)
    if (snapshot) return title.includes(snapshot[1])
    const match = version.id.match(/^(\d+\.\d+(?:\.\d+)?)(-(rc|pre)(\d+)$)?/)
    if (!match) return false
    switch (match[3]) {
      case 'rc': return title.includes(match[1] + ' Release Candidate')
      case 'pre': return title.includes(match[1] + ' Pre-Release')
      default: return title.includes(version.id)
    }
  })
  const article = candidates[0]
  if (!article) return {}
  const tile = article.default_tile
  let imageURL = 'https://minecraft.net' + tile.image.imageURL
  const headerImageURL = imageURL.replace('1x1', 'header')
  if (headerImageURL !== imageURL && await checkImage(headerImageURL)) {
    imageURL = headerImageURL
  }
  return {url: 'https://minecraft.net' + article.article_url, title: tile.title, subtitle: tile.sub_header, image: imageURL}
}

async function getArticle(version) {
  const infos = (await Promise.allSettled([
    getArticleInfo(version),
    getPatchNotesInfo(version)
  ])).map(r => r.value || {})
  return {...infos[0], ...infos[1]}
}

async function checkImage(url) {
  try {
    // See if this would work as an embed
    await (await fetch(url, {timeout: 1000, method: 'HEAD', headers: {'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'}})).buffer()
    return true
  } catch (e) {
    return false
  }
}
