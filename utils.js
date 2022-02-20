export function replyNoMention(interaction, response) {
    if (typeof response === 'object') {
        response.allowedMentions = {repliedUser: false}
    } else {
        response = {content: response, allowedMentions: {repliedUser: false}}
    }
    return interaction.deferred ? interaction.editReply(response) : interaction.reply(response)
}

export function editNoMention(msg, response) {
    if (typeof response === 'object') {
        response.allowedMentions = {repliedUser: false}
    } else {
        response = {content: response, allowedMentions: {repliedUser: false}}
    }
    return msg.edit(response)
}

export function reformatUUID(uuid) {
    if (uuid.includes('-')) return reformatUUID(uuid.replace(/-/g, ''))
    return uuid.slice(0, 8) + '-' + uuid.slice(8, 12) + '-' + uuid.slice(12, 16) + '-' + uuid.slice(16, 20) + '-' + uuid.slice(20)
}

export function readFully(stream) {
    return new Promise((resolve, reject) => {
        let data = ''
        stream.on('data', d => data += d)
        stream.on('end', () => resolve(data))
        stream.on('err', reject)
    })
}