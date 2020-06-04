const Telegraf = require('telegraf')
const Telegram = require('telegraf/telegram')
const express = require('express')
const request = require('request')
require('dotenv').config()

// EventEmitter type is built-in to nodejs, no package to install
const EventEmitter = require('events')

// Local imports
const Game = require('./Game')
const convertGameDataToCytoscape = require('./cytoscape-converter')
const { generateTestEdges } = require('./test-data')

// this will transmit events from the telegram bot listeners
// over an internal channel, where the events are named by the
// user id who sent the message
const messageBus = new EventEmitter()

// ENVIRONMENT VARIABLES
const GAME_URL = process.env.GAME_URL
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TESTING_MODE = process.env.TESTING_MODE === 'true'
const PORT = process.env.PORT

// TEST VARIABLES THAT CAN BE TWEAKED DURING TESTING
const NETWORK_DENSITY_PERCENT = 40

// documentation
// https://telegraf.js.org/#/?id=introduction
const bot = new Telegraf(BOT_TOKEN)
const telegram = new Telegram(BOT_TOKEN)

// key will be group id, value will be "game" being played
// only one game per time in a group
const ARCHIVED_GAMES = {}
const GAMES = {}

function archiveGame(groupId) {
  // make sure the array for archiving this groups games exists
  if (!ARCHIVED_GAMES[groupId]) {
    ARCHIVED_GAMES[groupId] = []
  }
  // add it to this groups archived game list
  const game = GAMES[groupId]
  ARCHIVED_GAMES[groupId].push(game)
  // remove it from the active games reference
  delete GAMES[groupId]
}

// example of middleware
bot.use(async (ctx, next) => {
  const start = new Date()
  await next()
  const ms = new Date() - start
  console.log('Response time: %sms', ms)
})

function getMessage(ctx) {
  return ctx.update.message
}

function getGroupId(ctx) {
  return getMessage(ctx).chat.id
}

// Mware = middleware
// verify this chat message occurred within a group setting
function groupMware(noisy = true) {
  return async function groupMware(ctx, next) {
    const message = getMessage(ctx)
    if (
      !(message.chat.type === 'group' || message.chat.type === 'supergroup')
    ) {
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
      'there is already a game in progress in this group. finish that one first.'
    )
  }
  const game = new Game({ groupId, telegram, messageBus, gameUrl: GAME_URL })
  GAMES[groupId] = game
  return ctx.reply(
    'who wants to play? reply with "me" if you do. If this is your first time playing, please click this link, @relater_bot , and send the bot any message at all before returning here. run the /ready command when all players are in'
  )
})

// the /ready command, start a game that's been initiated and has players
// gameMware will validate that there's a game in progress
function noReadyTwice(ctx, next) {
  const game = ctx.groupGame
  if (game.running) {
    return ctx.reply(
      'there is already a game in progress in this group. finish that one first.'
    )
  } else {
    return next()
  }
}
bot.command('ready', groupMware(), gameMware(), noReadyTwice, async (ctx) => {
  const groupId = getGroupId(ctx)
  const game = ctx.groupGame
  const LEAST_PLAYERS = TESTING_MODE ? 1 : 2
  if (game.players.length < LEAST_PLAYERS) {
    return ctx.reply('You need at least two players to start the game')
  }

  await ctx.reply(
    'ok lets play! everyone please go to your direct message chat with this bot (@relater_bot) to play'
  )

  // start the game
  game.startGame(ctx).then(() => {
    // this is necessary to make it available for viewing
    archiveGame(groupId)
  })
})

// in groupMware, fail silently
// only respond to 'me' statements for me, joining in a game
// this matches only the direct word matching 'me', or 'Me', nothing else
bot.hears(/^(m|M)e$/, groupMware(false), gameMware(false), (ctx) => {
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
  messageBus.emit(userId, ctx)
})

// handle a request to "play the game" by
// sending back the live URL of the HTML game
bot.gameQuery(async (ctx) => {
  const groupId = ctx.update.callback_query.message.chat.id
  let result
  try {
    result = await ctx.answerCbQuery(null, null, {
      // TODO find a way to get gameId in here
      url: `${GAME_URL}?groupId=${groupId}&gameId=`,
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
  app.get('/data/default-test/default-test', async (req, res) => {
    // const game = new Game({
    //   groupId: '123',
    //   telegram,
    //   messageBus,
    //   gameUrl: GAME_URL,
    // })
    // // everyones responses
    // const densityPercentage = NETWORK_DENSITY_PERCENT
    // game.data = generateTestEdges(game, densityPercentage)

    // // convert game data to cytoscape format
    // const cytoscapeData = await convertGameDataToCytoscape(telegram, game)
    const cytoscapeData = require('./rsf-flow-metacaugs.json')

    // send the data back as the response to the http request
    res.send(cytoscapeData)
  })
}

// DATA fetcher endpoint, where the data from a game, for a group,
// is formatted to cytoscape friendly format
app.get('/data/:groupId/:gameId', async (req, res) => {
  const { groupId, gameId } = req.params

  const groupGames = ARCHIVED_GAMES[groupId]
  if (!groupGames || !groupGames.length) {
    return res.sendStatus(404)
  }
  console.log(groupGames)
  const game = groupGames.find((game) => game.id === gameId)
  if (!game) {
    return res.sendStatus(404)
  }
  const cytoscapeData = await convertGameDataToCytoscape(telegram, game)
  res.send(cytoscapeData)
})

//  handle profile picture requests the weird telegram way
app.get('/profiles/:file_id', async (req, res) => {
  try {
    let pic_url = await telegram.getFileLink(req.params.file_id) // midsize 320 x 320
    request(pic_url).pipe(res)
  } catch (e) {
    console.log('could not fetch profile image: ' + e.message)
    res.sendStatus(404)
  }
})

app.listen(PORT, () => console.log(`App listening at http://localhost:${PORT}`))
