const Telegraf = require('telegraf')
const Telegram = require('telegraf/telegram')
require('dotenv').config()

// EventEmitter type is built-in to nodejs, no package to install
const EventEmitter = require('events')

// this will transmit events from the telegram bot listeners
// over an internal channel, where the events are named by the 
// user id who sent the message
const eventBus = new EventEmitter()

// documentation
// https://telegraf.js.org/#/?id=introduction

const token = process.env.TELEGRAM_BOT_TOKEN
const bot = new Telegraf(token)
const telegram = new Telegram(token)

// key will be group id, value will be "game" being played
// only one game per time in a group
const games = {}

class Game {
  constructor(groupId) {
    this.groupId = groupId
    this.players = []
    // player data, keyed by player id
    this.playerData = {}
    this.running = false
  }

  // during setup stage of the game
  addPlayer(userId, userData) {
    this.players.push(userId)
    this.playerData[userId] = userData
  }

  // core 1-on-1 interaction to ask about how well someone knows someone else
  async playerAndPlayerConnection(playerToAsk, playerToAskAbout) {
    /*
          id
          first_name
          last_name
          username
        */

    console.log(
      `detecting relationship between ${playerToAsk.id} and ${playerToAskAbout.id}`
    )

    const levels = `
        0 - I've never seen / heard of them before online or otherwise 
        1 - I've seen their name or avatar before, but we've never interacted in any way
        2 - We've interacted a little online, but we've never been in each other's presence in any way before
        3 - We've been in each other's presence, but have yet to talk
        4 - We've met and/or introduced ourselves to each other.
        5 - We've had some opportunites to get to know each other better, but not many
        6 - We've had a 1on1 conversation together
        7 - We've met/interacted many times and gotten to know each other
        8 - We're good friends/colleagues
        9 - We're partners/spouses
        `

    const otherPlayersName = playerToAskAbout.first_name
    telegram.sendMessage(
      playerToAsk.id,
      `how well do you know ${otherPlayersName} (@${playerToAskAbout.username})`
    )
    telegram.sendMessage(
      playerToAsk.id,
      `use the following guide to assign a number to your connection`
    )
    telegram.sendMessage(
      playerToAsk.id,
      `type in the highest number that you would say is true about your connection, and send as a reply to this message`
    )
    telegram.sendMessage(playerToAsk.id, levels)
    // be able to share an anecdote by voice or text of
    // how you first connected

    // listen for specific responses, and associate a response with a
    // question
    const response = await new Promise((resolve, reject) => {
      eventBus.once(playerToAsk.id, (ctx) => {
        resolve(ctx.message.text)
      })
    })

    // create a connection object to return, like an edge in the graph
    return {
      playerAsked: playerToAsk,
      playerAskedAbout: playerToAskAbout,
      strength: response,
    }
  }

  // generator function
  async *iteratePlayerConnections(playerToAsk) {
    // create a list of the IDs of other players
    const otherPlayers = this.players.filter(
      (playerId) => playerId !== playerToAsk.id
    )

    // run a loop, where, for each player, we ask the "playerToAsk" about the
    // relationship with the "playerToAskAbout"
    for (let i = 0; i < otherPlayers.length; i++) {
      const playerToAskAboutId = otherPlayers[i]
      const playerToAskAbout = this.playerData[playerToAskAboutId]
      const connection = await this.playerAndPlayerConnection(
        playerToAsk,
        playerToAskAbout
      )
      // the yield keyword is what makes this a generator function
      yield connection
    }
  }

  async askPlayerAboutAllPlayers(playerToAsk) {
    const allPlayersConnections = []
    let generator = this.iteratePlayerConnections(playerToAsk)
    // because its an async generator, we can use `for await ... of`
    for await (let connection of generator) {
      connections.push(connection)
    }
    return allPlayersConnections
  }

  async startGame() {
    // define game running logic here
    this.running = true
    const promises = []
    this.players.forEach((playerId) => {
      const playerData = this.playerData[playerId]
      const promise = this.askPlayerAboutAllPlayers(playerData)
      // push the promise onto the promises array, for inclusion in the Promise.all
      promises.push(promise)
    })
    // this waits for every promise to finish
    const allConnections = await Promise.all(promises)

    // it has everyones responses to all connections
    console.log(allConnections)
  }
}

// example of middleware
bot.use(async (ctx, next) => {
  const start = new Date()
  await next()
  const ms = new Date() - start
  console.log('Response time: %sms', ms)
})

function getGroupId(ctx) {
  return ctx.update.message.chat.id
}

// Mware = middleware
// verify this chat message occurred within a group setting
function groupMware(noisy = true) {
  return async function groupMware(ctx, next) {
    if (ctx.update.message.chat.type !== 'group') {
      if (noisy) {
        return ctx.reply(
          'game can only be played in a group setting. add me to a group'
        )
      } else return // silently do nothing
    }
    // in a group, carry on
    return next()
  }
}

// set a game onto the context for this group, if one exists
// should already have been passed through groupMware to work
function gameMware(noisy = true) {
  return async function gameMware(ctx, next) {
    const groupId = getGroupId(ctx)
    const game = games[groupId]
    if (!game) {
      if (noisy) {
        return ctx.reply(
          'there is no game in progress in this group. start one by using /run'
        )
      } else return // silently do nothing
    }
    ctx.groupGame = game
    return next()
  }
}

// the main /run command, initiate a new game
bot.command('run', groupMware(), (ctx) => {
  const groupId = getGroupId(ctx)
  if (games[groupId]) {
    return ctx.reply(
      'there is already a game in progress in this group. finish that one first'
    )
  }
  const game = new Game(groupId)
  games[groupId] = game
  return ctx.reply(
    'who wants to play? reply with "me" if you do. run the /ready command when all players are in'
  )
})

// the /ready command, start a game that's been iniatiated and has players
// gameMware will validate that there's a game in progress
bot.command('ready', groupMware(), gameMware(), (ctx) => {
  const game = ctx.groupGame
  const LEAST_PLAYERS = 1
  if (game.players.length < LEAST_PLAYERS) {
    return ctx.reply('You need at least two players to start the game')
  }

  // start the game
  game.startGame()

  return ctx.reply(
    'ok lets play! everyone please go to your direct message chat with this bot (@relater_bot) and send me a message to initiate'
  )
})

// general text message handler
// in groupMware, fail silently
// only respond to 'me' statements for me, joining in a game
bot.hears(/me/, groupMware(false), gameMware(false), (ctx) => {
  const game = ctx.groupGame
  const userId = ctx.update.message.from.id
  const user = ctx.update.message.from

  // user.first_name

  // check if they already registered
  if (game.players.indexOf(userId) > -1) {
    return ctx.reply('you are already registered for the game')
  }

  game.addPlayer(userId, user)
  // TODO: make a comment about sending "Me" the bot a DM, to initiate contact
  return ctx.reply('added you to the game')
})

// match any message
bot.hears(/.*/g, (ctx) => {
  // ignore non-DMs
  if (ctx.update.message.chat.type !== 'private') return

  // forward DM messages over the event bus, so that we can
  // dynamically subscribe and unsubscribe elsewhere in the code
  const userId = ctx.update.message.from.id
  // magic portal, using the userId as the event type (channel)
  eventBus.emit(userId, ctx)
})

/* PSEUDO CODE ZONE

run graph analysis on results

share graph analysis image

*/

bot.launch()
