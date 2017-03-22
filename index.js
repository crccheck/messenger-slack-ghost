const { Messenger, Text } = require('launch-vehicle-fbm')
const { MemoryDataStore, RtmClient, WebClient } = require('@slack/client')
const RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM
const RTM_EVENTS = require('@slack/client').RTM_EVENTS
const settings = require('./settings')

const web = new WebClient(process.env.SLACK_API_TOKEN)
const messenger = new Messenger({emitGreetings: false, pages: settings.pages})
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

function findMetaForThread (ts) {
  let key, value
  for ([key, value] of threadStore) {
    if (value === ts) {
      return key.split(':')
    }
  }
}

function post (channelId, text, event, session) {
  let username
  let threadKey
  const pageId = session._pageId
  if (event.message.is_echo) {
    if (event.message.app_id === process.env.FACEBOOK_APP_ID) {
      console.log('IGNOREING MESSAGE')
      // Ignore messages from yourself
      return
    }
    username = settings.apps[event.message.app_id] || event.message.app_id
    threadKey = event.recipient.id + ':' + pageId
  } else {
    username = `${session.profile.first_name} ${session.profile.last_name}`
    threadKey = event.sender.id + ':' + pageId
  }
  // Use the web client b/c the rtm client can't override icon_url/username or do threads
  web.chat.postMessage(channelId, text, {
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
  const channelId = getChannelId(process.env.SLACK_CHANNEL, rtm.dataStore)

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

  messenger.on('message.template', ({event, session, attachment}) => {
    const text = attachment.title
    post(channelId, text, event, session)
  })

  const user = rtm.dataStore.getUserById(rtm.activeUserId)
  const team = rtm.dataStore.getTeamById(rtm.activeTeamId)
  console.log(`Connected to ${team.name} as ${user.name}`)
})

rtm.on(RTM_EVENTS.MESSAGE, (message) => {
  if (!message.thread_ts || !message.user) {
    // Must be in a thread, and must be from a human
    // FIXME must be in a thread about a message
    return
  }

  try {
    const [senderId, pageId] = findMetaForThread(message.thread_ts)
    return messenger.send(senderId, new Text(message.text), pageId)
  } catch (e) {
    console.error(`No thread found ${message.text}`)
    // TODO figure out how to not trigger on random threaded conversations
    // return web.chat.postMessage(message.channel, '_Sorry, but this thread is closed to new messages_', {
    //   thread_ts: message.thread_ts,
    // })
  }
})

messenger.start()
rtm.start()
