import fs from 'fs'
import {Client} from 'discord.js'
import {REST} from '@discordjs/rest'
import {GatewayIntentBits, Routes} from 'discord-api-types/v10'

const config = JSON.parse(fs.readFileSync('./config.json'))
const client = new Client({intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers, GatewayIntentBits.MessageContent]})

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`)
  // Set the presence for the bot (Listening to !help)
  client.user.setPresence({
    status: 'online',
    activities: [{
      name: config.prefix + 'help',
      type: 'LISTENING'
    }]
  })
})

;(async () => {
  const commands = []
  for (const module in config.modules) {
    const modConfig = config.modules[module]
    if (!modConfig) continue
    if (!fs.existsSync('./modules/' + module + '/index.js')) continue
    const m = await import('./modules/' + module + '/index.js')
    const moduleCommands = (await m.default(client, config, modConfig)) || []
    for (const command of moduleCommands) {
      if (command.toJSON) {
        commands.push(command.toJSON())
      } else {
        commands.push(command)
      }
    }
  }

  if (!commands.length) return
  const rest = new REST({version: '9'}).setToken(config.token)
  client.on('ready', () => {
    const clientId = client.application.id
    rest.put(
      config.guild
        ? Routes.applicationGuildCommands(clientId, config.guild)
        : Routes.applicationCommands(clientId),
      {body: commands}
    )
  })

  // Login with token
  client.login(config.token)
})()
