const { Messenger } = require('launch-vehicle-fbm')
const reqPromise = require('request-promise')

const messenger = new Messenger()

messenger.on('text', ({text, session}) => {
  return reqPromise.post({
    url: process.env.SLACK_WEBHOOK_URL,
    body: {
      channel: process.env.SLACK_CHANNEL,
      icon_url: session.profile.profile_pic,
      username: `${session.profile.first_name} ${session.profile.last_name}`,
      text
    },
    json: true
  })
})

messenger.start()
