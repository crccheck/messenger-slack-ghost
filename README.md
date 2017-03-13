Messenger Slack Ghost
=====================

A proof of concept of how to use [launch-vehicle-fbm] with Slack.


This bot subscribes to multiple page's feeds, and relays everything but
postback dialogs to a Slack room. All conversations are threaded, and you can
message the user directly by replying in the thread.


Known issues
------------

* If there's another bot, it will have to know how to step aside if you attempt a conversation takeover
* Messenger does not echo postback dialogs, so this bot is blind to those


[launch-vehicle-fbm]: https://github.com/CondeNast/launch-vehicle-fbm
