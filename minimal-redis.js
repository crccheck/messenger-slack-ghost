const redis = require('redis')
const { promisifyAll } = require('bluebird')


promisifyAll(redis.RedisClient.prototype)
promisifyAll(redis.Multi.prototype)


class Cache {
  constructor (redisUrl, prefix = '', ttl) {
    this.client = redis.createClient(redisUrl)
    this.prefix = prefix
    if (this.prefix && this.prefix[this.prefix.length - 1] !== ':') {
      this.prefix += ':'
    }
  }

  get (key) {
    return this.client.getAsync(this.prefix + key)
      .then((data) => {
        if (data) {
          return JSON.parse(data)
        }

        return data  // Not found, return null
      })
  }

  set (key, value, ttl) {
    if (!value) {
      return
    }

    const realTTL = ttl || this.ttl
    const setPromise = realTTL
      ? this.client.setAsync(this.prefix + key, JSON.stringify(value), realTTL)
      : this.client.setAsync(this.prefix + key, JSON.stringify(value))
    return setPromise
      .then((response) => {
        if (response === 'OK') {
          return value
        }

        return response
      })
  }
}

exports.Cache = Cache
