const { Messenger } = require('launch-vehicle-fbm')
const { MemoryDataStore, RtmClient, WebClient } = require('@slack/client')
const RTM_CLIENT_EVENTS = require('@slack/client').CLIENT_EVENTS.RTM

const CHANNEL = process.env.SLACK_CHANNEL


const web = new WebClient(process.env.SLACK_API_TOKEN)
const messenger = new Messenger()
const rtm = new RtmClient(process.env.SLACK_API_TOKEN, {
  logLevel: 'error',
  dataStore: new MemoryDataStore()
})

function getChannelId(dataStore, name) {
  const needle = name.replace(/^#/, '')
  const data = dataStore.getChannelByName(needle) || dataStore.getGroupByName(needle)
  return data.id
}

rtm.on(RTM_CLIENT_EVENTS.RTM_CONNECTION_OPENED, () => {
  const id = getChannelId(rtm.dataStore, CHANNEL)

  messenger.on('text', ({text, session}) => {
    console.log(session.profile)
    // the rtm client can't override icon_url/username
    web.chat.postMessage(id, text, {
      icon_url: session.profile.profile_pic,
      username: `${session.profile.first_name} ${session.profile.last_name}`,
      thread_ts: session.thread_ts
    }, (err, res) => {
      if (err) {
        console.error(err)
        return
      }

      if (!session.thread_ts) {
        session.thread_ts = res.ts
      }
      console.log(res)
    })
  })

  const user = rtm.dataStore.getUserById(rtm.activeUserId)
  const team = rtm.dataStore.getTeamById(rtm.activeTeamId)
  console.log('Connected to ' + team.name + ' as ' + user.name)
});

messenger.start()
rtm.start()
