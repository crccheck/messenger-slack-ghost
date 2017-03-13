const { Messenger, Text } = require('launch-vehicle-fbm')
const { MemoryDataStore, RtmClient, WebClient } = require('@slack/client')
const RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM
const RTM_EVENTS = require('@slack/client').RTM_EVENTS

const CHANNEL = process.env.SLACK_CHANNEL


const web = new WebClient(process.env.SLACK_API_TOKEN)
const messenger = new Messenger({emitGreetings: false})
const rtm = new RtmClient(process.env.SLACK_API_TOKEN, {
  logLevel: 'error',
  dataStore: new MemoryDataStore(),
})

// UTILITIES
////////////

function getChannelId (name, dataStore) {
  const needle = name.replace(/^#/, '')  // getGroupByName does not like prefixes
  const data = dataStore.getChannelByName(needle) || dataStore.getGroupByName(needle)
  return data.id
}

const threadStore = new Map()

function findSenderForThread (ts) {
  let key, value
  for ([key, value] of threadStore) {
    if (value === ts) {
      return key
    }
  }
}

function post (slackChannelId, text, event, session) {
  let username
  let threadKey
  if (event.message.is_echo) {
    username = event.message.app_id
    threadKey = event.recipient.id
  } else {
    username = `${session.profile.first_name} ${session.profile.last_name}`
    threadKey = event.sender.id
  }
  // Use the web client b/c the rtm client can't override icon_url/username or do threads
  web.chat.postMessage(slackChannelId, text, {
    icon_url: session.profile.profile_pic,
    username,
    thread_ts: threadStore.get(threadKey),
  }, (err, res) => {
    if (err) {
      console.error(err)
      return
    }

    if (!threadStore.has(threadKey)) {
      threadStore.set(threadKey, res.ts)
    }
  })
}

// EVENTS
/////////

rtm.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, () => {
  const channelId = getChannelId(CHANNEL, rtm.dataStore)

  messenger.on('text', ({event, text, session}) => {
    post(channelId, text, event, session)
  })

  messenger.on('message.image', ({event, url, session}) => {
    post(channelId, url, event, session)
  })

  messenger.on('message.sticker', ({event, url, session}) => {
    post(channelId, url, event, session)
  })

  messenger.on('message.thumbsup', ({event, session}) => {
    // Ignore the url and use the native Slack thumbsup
    post(channelId, ':thumbsup:', event, session)
  })

  const user = rtm.dataStore.getUserById(rtm.activeUserId)
  const team = rtm.dataStore.getTeamById(rtm.activeTeamId)
  console.log(`Connected to ${team.name} as ${user.name}`)
})

rtm.on(RTM_EVENTS.MESSAGE, (message) => {
  if (!message.thread_ts || !message.user) {
    // Must be in a thread, and must be from a human
    return
  }

  const senderId = findSenderForThread(message.thread_ts)
  if (senderId) {
    return messenger.send(senderId, new Text(message.text))
  }

  console.error(`No thread found ${message.text}`)
  return web.chat.postMessage(message.channel, '_Sorry, but this thread is closed to new messages_', {
    thread_ts: message.thread_ts,
  })
})

messenger.start()
rtm.start()
