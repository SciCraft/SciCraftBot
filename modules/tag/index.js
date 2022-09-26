import fs, { existsSync } from 'fs'
import {SlashCommandBuilder} from '@discordjs/builders'

let tags

export default function(client, _globalConfig, _config) {
    tags = readTags()

    client.on('interactionCreate', async interaction => {
        if (interaction.isAutocomplete()) {
            await handleAutocomplete(interaction).catch(console.error);
        } else if (interaction.isCommand()) {
            await handleCommand(interaction).catch(error => {
                console.error(error);
                interaction.reply({ content: 'There was an error while executing this command', ephemeral: true });
            });
        }
    })

    return [
        new SlashCommandBuilder()
            .setName('createtag')
            .setDescription('Creates a tag')
            .setDMPermission(false)
            .addStringOption(option => option.setName('name').setDescription('The name of the tag').setRequired(true))
            .addStringOption(option => option.setName('content').setDescription('The message to return as the output'))
            .addAttachmentOption(option => option.setName('attachment').setDescription('The attachment to return as the output')),
        new SlashCommandBuilder()
            .setName('deletetag')
            .setDescription('Deletes a tag')
            .setDMPermission(false)
            .addStringOption(option => option.setName('tag').setDescription('The tag to delete').setAutocomplete(true).setRequired(true)),
        new SlashCommandBuilder()
            .setName('listtags')
            .setDescription('Lists all available tags'),
        new SlashCommandBuilder()
            .setName('tag')
            .setDescription('Displays a tag')
            .addStringOption(option => option.setName('tag').setDescription('The tag to get information about').setAutocomplete(true).setRequired(true))
    ]
}

function readTags() {
	return existsSync('./tags.json') ? JSON.parse(fs.readFileSync('./tags.json')) : {}
}

function writeTags(tags) {
	fs.writeFileSync(
		'./tags.json',
		JSON.stringify(tags, (key, value) => value ?? undefined, 3)
	);
}

async function handleAutocomplete(interaction) {
	if (interaction.commandName === 'tag' || interaction.commandName == 'deletetag') {
		const focusedValue = interaction.options.getFocused().toLowerCase()
		await interaction.respond(
			Object.keys(tags)
				.filter(option => option.toLowerCase().includes(focusedValue))
				.sort((a, b) => a.localeCompare(b, { sensitivity: 'base' }))
				.sort((optionA, optionB) => optionB.toLowerCase().startsWith(focusedValue) - optionA.toLowerCase().startsWith(focusedValue))
				.slice(0, 25)
				.map(option => ({ name: option, value: option }))
		)
	}
}

async function updateTags(fn) {
    tags = readTags()
    const result = await fn(tags)
    writeTags(tags)
    return result
}

async function handleCommand(interaction) {
	if (interaction.commandName == 'tag') {
		const name = interaction.options.getString('tag')
		const tags = readTags()
		const tag = Object.keys(tags).find(key => key.toLowerCase() == name.toLowerCase())
		if (!tag) {
			return await interaction.reply({ content: "That tag doesn't exist", ephemeral: true })
		}

		const { content, attachments } = tags[tag];
		await interaction.reply({ content, files: attachments ? attachments : undefined })
	} else if (interaction.commandName == 'createtag') {
		const name = interaction.options.getString('name')
		const content = interaction.options.getString('content')
		const attachment = interaction.options.getAttachment('attachment')

		if (!content && !attachment) {
			return await interaction.reply({ content: 'You have to provide either a message or an attachment', ephemeral: true })
		}

        return await updateTags(async tags => {
            const tag = Object.keys(tags).find(key => key.toLowerCase() == name.toLowerCase())
            if (tag) {
                return await interaction.reply({ content: 'A tag with that name already exists', ephemeral: true })
            }
            tags[name] = { content, attachments: attachment && [attachment?.url] }
            return await interaction.reply(`Succesfully created the ${name} tag`)
        })
	} else if (interaction.commandName == 'deletetag') {
		const name = interaction.options.getString('tag')

        return await updateTags(async tags => {
            const tag = Object.keys(tags).find(key => key.toLowerCase() === name.toLowerCase())
            if (!tag) {
                return await interaction.reply({ content: "That tag doesn't exist", ephemeral: true })
            }
            delete tags[tag]
            return await interaction.reply(`Succesfully deleted the ${tag} tag`)
        })
	} else if (interaction.commandName == 'listtags') {
		const tagNames = Object.keys(readTags())
		await interaction.reply(tagNames.length
            ? `Available tags: ${tagNames.sort((a, b) => a.localeCompare(b, { sensitivity: 'base' })).join(', ')}`
            : 'No tags exist'
        )
	}
}
