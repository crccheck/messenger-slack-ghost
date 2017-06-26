const Cacheman = require('cacheman')
const CachemanRedis = require('cacheman-redis')
const debug = require('debug')('slack-ghost')
const { Messenger, Text } = require('launch-vehicle-fbm')
const redisUrlParse = require('redis-url-parse')
const { MemoryDataStore, RtmClient, WebClient } = require('@slack/client')
const RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM
const RTM_EVENTS = require('@slack/client').RTM_EVENTS

const web = new WebClient(process.env.SLACK_API_TOKEN)
debug('Using redis cache backend: %s', process.env.REDIS_URL)
const cacheOptions = {
  engine: new CachemanRedis(redisUrlParse(process.env.REDIS_URL)),
  prefix: process.env.FACEBOOK_APP_ID,
  ttl: 7 * 24 * 60 * 60, // 1 week in seconds
}
let pages
try {
  pages = JSON.parse(process.env.SLACK_GHOST_PAGES)
} catch (err) {
  console.error('FATAL: Invalid SLACK_GHOST_PAGES config, is it set? Message: %s', err.message)
  process.exit(1)
}
const fbmCache = new Cacheman('sessions', cacheOptions)
const messenger = new Messenger({emitGreetings: false, pages, cache: fbmCache})
const rtm = new RtmClient(process.env.SLACK_API_TOKEN, {
  logLevel: 'error',
  dataStore: new MemoryDataStore(),
})
const threadCache = new Cacheman('threads', cacheOptions)
const apps = JSON.parse(process.env.SLACK_GHOST_APPS || '{}')


// UTILITIES
////////////

function getChannelId (name, dataStore) {
  const needle = name.replace(/^#/, '') // getGroupByName does not like prefixes
  const data = dataStore.getChannelByName(needle) || dataStore.getGroupByName(needle)
  return data.id
}

function post (channelId, text, event, session) {
  let senderId
  let threadKey
  let username
  const pageId = session._pageId
  if (event.message.is_echo) {
    if (event.message.app_id === process.env.FACEBOOK_APP_ID) {
      debug('IGNORING MESSAGE TO MYSELF: %s', text)
      return
    }

    username = apps[event.message.app_id] || event.message.app_id
    senderId = event.recipient.id
  } else {
    username = `${session.profile.first_name} ${session.profile.last_name}`
    senderId = event.sender.id
  }
  threadKey = pageId + ':' + senderId

  let threadTs
  threadCache.get(threadKey)
    .then((value) => {
      debug('looking at %s got %s', threadKey, value)
      threadTs = value
      // Use the web client b/c the rtm client can't override icon_url/username or do threads
      return web.chat.postMessage(channelId, text, {
        icon_url: session.profile.profile_pic,
        username,
        thread_ts: threadTs,
      })
    })
    .then((res) => {
      if (!threadTs) {
        debug('Saving thread for future use %s', res.ts)
        // Using a basic redis client would let us do multi-set
        return Promise.all([
          threadCache.set(`thread:${res.ts}`, {pageId, senderId}),
          threadCache.set(threadKey, res.ts),
        ])
      }
    })
    .catch(console.error)
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
    return
  }

  return threadCache.get(`thread.${message.thread_ts}`)
    .then(({senderId, pageId} = {}) => {
      if (senderId && pageId) {
        return messenger.pageSend(pageId, senderId, new Text(message.text))
      }
    })
    .catch(console.error)
})

messenger.start()
rtm.start()
