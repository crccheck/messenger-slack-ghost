const pify = require('bluebird').promisify
const Cacheman = require('cacheman')
const CachemanRedis = require('cacheman-redis')
const debug = require('debug')('slack-ghost')
const { Messenger, Text } = require('launch-vehicle-fbm')
const redisUrlParse = require('redis-url-parse')
const { MemoryDataStore, RtmClient, WebClient } = require('@slack/client')
const RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM
const RTM_EVENTS = require('@slack/client').RTM_EVENTS
const settings = require('./settings')

const web = new WebClient(process.env.SLACK_API_TOKEN)
debug('Using redis cache backend: %s', process.env.REDIS_URL)
const cacheOptions = {
  engine: new CachemanRedis(redisUrlParse(process.env.REDIS_URL)),
  prefix: process.env.FACEBOOK_APP_ID,
  ttl: 7 * 24 * 60 * 60,  // 1 week in seconds
}
const fbmCache = new Cacheman('sessions', cacheOptions)
const messenger = new Messenger({emitGreetings: false, pages: settings.pages, cache: fbmCache})
const rtm = new RtmClient(process.env.SLACK_API_TOKEN, {
  logLevel: 'error',
  dataStore: new MemoryDataStore(),
})
const threadCache = new Cacheman('threads', cacheOptions)


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
      debug('IGNORING MESSAGE TO MYSELF: %s', text)
      return
    }

    username = settings.apps[event.message.app_id] || event.message.app_id
    threadKey = event.recipient.id + ':' + pageId
  } else {
    username = `${session.profile.first_name} ${session.profile.last_name}`
    threadKey = event.sender.id + ':' + pageId
  }
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
        // threadCache.set(res.ts, {})
        return threadCache.set(threadKey, res.ts)
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
    // FIXME must be in a thread about a message
    return
  }

  try {
    const [senderId, pageId] = findMetaForThread(message.thread_ts)
    return messenger.pageSend(pageId, senderId, new Text(message.text))
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
