const { Cache } = require('./minimal-redis')

const cache = new Cache(process.env.REDIS_URL)

cache.get('hi', {foo: 'bar'}).then(console.log)
