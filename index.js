const Telegraf = require('telegraf')
const Telegram = require('telegraf/telegram')
const Extra = require('telegraf/extra')
const Markup = require('telegraf/markup')
const express = require('express')
require('dotenv').config()

// EventEmitter type is built-in to nodejs, no package to install
const EventEmitter = require('events')

// Local imports
const convertGameDataToCytoscape = require('./cytoscape-converter')

// this will transmit events from the telegram bot listeners
// over an internal channel, where the events are named by the
// user id who sent the message
const eventBus = new EventEmitter()

// ENVIRONMENT VARIABLES
const GAME_SHORT_NAME = process.env.GAME_SHORT_NAME
const GAME_URL = process.env.GAME_URL
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TESTING_MODE = process.env.TESTING_MODE === 'true'
const PORT = process.env.PORT

// documentation
// https://telegraf.js.org/#/?id=introduction
const bot = new Telegraf(BOT_TOKEN)
const telegram = new Telegram(BOT_TOKEN)

// key will be group id, value will be "game" being played
// only one game per time in a group
const ARCHIVED_GAMES = {}
const GAMES = {}

/*
/start GAME CLASS DEFINITION
*/

const testPlayerDataArray = ['1', '2', '3', '4']
const testPlayerDataObject = {
  '1': {
    id: '1',
    first_name: 'Agent',
    last_name: '1',
    username: 'agent1',
    test: true,
  },
  '2': {
    id: '2',
    first_name: 'Agent',
    last_name: '2',
    username: 'agent2',
    test: true,
  },
  '3': {
    id: '3',
    first_name: 'Agent',
    last_name: '3',
    username: 'agent3',
    test: true,
  },
  '4': {
    id: '4',
    first_name: 'Agent',
    last_name: '4',
    username: 'agent4',
    test: true,
  },
}

class Game {
  constructor(groupId) {
    this.groupId = groupId
    if (TESTING_MODE) {
      this.players = testPlayerDataArray
      this.playerData = testPlayerDataObject
    } else {
      this.players = []
      // player data, keyed by player id
      this.playerData = {}
    }
    this.running = false
  }

  /*
    built-in methods for Game instances
  */

  // during setup stage of the game
  addPlayer(userId, userData) {
    this.players.push(userId)
    this.playerData[userId] = userData
  }

  archiveGame() {
    // make sure the array for archiving this groups games exists
    if (!ARCHIVED_GAMES[this.groupId]) {
      ARCHIVED_GAMES[this.groupId] = []
    }
    // add it to this groups archived game list
    ARCHIVED_GAMES[this.groupId].push(this)
    // remove it from the active games reference
    delete GAMES[this.groupId]
  }

  // core 1-on-1 interaction to ask about how well someone knows someone else
  async playerAndPlayerConnection(
    playerToAsk,
    playerToAskAbout,
    numberRemaining
  ) {
    /*
          id
          first_name
          last_name
          username
        */

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
    await telegram.sendMessage(
      playerToAsk.id,
      `how well do you know ${otherPlayersName} (@${playerToAskAbout.username})`
    )
    await telegram.sendMessage(
      playerToAsk.id,
      `use the following guide to assign a number to your connection`
    )
    await telegram.sendMessage(
      playerToAsk.id,
      `type in the highest number that you would say is true about your connection, and send as a reply to this message`
    )
    await telegram.sendMessage(playerToAsk.id, levels)
    await telegram.sendMessage(playerToAsk.id, `(${numberRemaining} remaining)`)

    // be able to share an anecdote by voice or text of
    // how you first connected

    // listen for specific responses, and associate a response with a
    // question, validate them and loop indefinitely till we
    // get a valid response
    let invalidResponse = true
    let response
    while (invalidResponse) {
      response = await playersNextMessageSent(playerToAsk.id)
      let parsed = Number.parseInt(response)
      if (parsed >= 0 && parsed <= 9) {
        // this will break us out of the `while` loop
        invalidResponse = false
      } else {
        // invalid response, so message them, and loop back to the start
        telegram.sendMessage(
          playerToAsk.id,
          "that wasn't a valid response. try again with a number between 0 and 9"
        )
      }
    }

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
        playerToAskAbout,
        // number remaining
        otherPlayers.length - i
      )
      // the yield keyword is what makes this a generator function
      // it means that for this particular call, "yield" this result.
      // similar to "return", but can be called succesively
      yield connection
    }
  }

  async askPlayerAboutAllPlayers(playerToAsk) {
    // ask this player in SEQUENCE about every other player and their connection
    // create an empty array to store all results
    const allPlayersConnections = []

    let generator = this.iteratePlayerConnections(playerToAsk)
    // because its an async generator, we can use `for await ... of`
    // which awaits one result, before initiating the next call
    for await (let connection of generator) {
      // just push the result into the results array
      allPlayersConnections.push(connection)
    }

    // let them know they're done
    await telegram.sendMessage(
      playerToAsk.id,
      'you have completed all of them! the group will be notified when ALL participants have completed and the results will be shared'
    )

    return allPlayersConnections
  }

  async startGame(ctx) {
    this.running = true

    // ask every player in PARALLEL about other players
    // Promise.all gives us parallelization, along with just initiating all the promises
    // without waiting for them to finish

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
    await ctx.reply('everyone has completed')
    await ctx.reply('open the following link to see the graph of connections')

    // store all the data on the game
    this.data = allConnections

    // create a graph and present it to the group
    this.archiveGame()

    const buttons = Extra.markup(
      Markup.inlineKeyboard([Markup.gameButton('Show graph')])
    )
    return ctx.replyWithGame(GAME_SHORT_NAME, buttons)
  }
}
/*
/end GAME CLASS DEFINITION
*/

function playersNextMessageSent(playerId) {
  return new Promise((resolve, reject) => {
    eventBus.once(playerId, (ctx) => {
      resolve(ctx.message.text)
    })
  })
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
    const game = GAMES[groupId]
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
  if (GAMES[groupId]) {
    return ctx.reply(
      'there is already a game in progress in this group. finish that one first'
    )
  }
  const game = new Game(groupId)
  GAMES[groupId] = game
  return ctx.reply(
    'who wants to play? reply with "me" if you do. run the /ready command when all players are in'
  )
})

// the /ready command, start a game that's been initiated and has players
// gameMware will validate that there's a game in progress
bot.command('ready', groupMware(), gameMware(), async (ctx) => {
  const game = ctx.groupGame
  const LEAST_PLAYERS = 1
  if (game.players.length < LEAST_PLAYERS) {
    return ctx.reply('You need at least two players to start the game')
  }

  await ctx.reply(
    'ok lets play! everyone please go to your direct message chat with this bot (@relater_bot) and send me a message to initiate'
  )

  // start the game
  game.startGame(ctx)
})

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

// handle a request to "play the game" by
// sending back the live URL of the HTML game
bot.gameQuery(async (ctx) => {
  const groupId = ctx.update.callback_query.message.chat.id
  let result
  try {
    result = await ctx.answerCbQuery(null, null, {
      url: `${GAME_URL}?groupId=${groupId}`,
      cache_time: 0,
    })
  } catch (e) {
    console.log(e)
  }
  return result
})

bot.launch()

// express js
const app = express()
const PUBLIC_FOLDER_NAME = 'public'
app.use(express.static(PUBLIC_FOLDER_NAME))

if (TESTING_MODE) {
  // DATA fetcher endpoint, where the data from a game, for a group,
  // is formatted to cytoscape friendly format
  app.get('/data/default-test', (req, res) => {
    const game = new Game('123')
    game.data = [
      [
        {
          playerAsked: game.playerData[game.players[0]],
          playerAskedAbout: game.playerData[game.players[1]],
          strength: 0.4,
        },
      ],
    ]
    const cytoscapeData = convertGameDataToCytoscape(game)
    res.send(cytoscapeData)
  })
}

// DATA fetcher endpoint, where the data from a game, for a group,
// is formatted to cytoscape friendly format
app.get('/data/:groupId', (req, res) => {
  const groupId = req.params.groupId

  const groupGames = ARCHIVED_GAMES[groupId]
  if (!groupGames || !groupGames.length) {
    return res.sendStatus(404)
  }

  // use the most recent game
  // TODO: create a way to get results of a specific game instead
  const lastGame = groupGames.length - 1
  const game = groupGames[lastGame]
  const cytoscapeData = convertGameDataToCytoscape(game)
  res.send(cytoscapeData)
})

app.listen(PORT, () => console.log(`App listening at http://localhost:${PORT}`))
