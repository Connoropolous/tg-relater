const fs = require('fs')
const path = require('path')
const Telegraf = require('telegraf')
const Telegram = require('telegraf/telegram')
const express = require('express')
const request = require('request')
require('dotenv').config()

// EventEmitter type is built-in to nodejs, no package to install
const { EventEmitter } = require('events')

// Local imports
const Game = require('./Game')
const convertGameDataToCytoscape = require('./cytoscape-converter')
// const { generateTestEdges } = require('./test-data')

// ENVIRONMENT VARIABLES
const GAME_URL = process.env.GAME_URL
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TESTING_MODE = process.env.TESTING_MODE === 'true'
const PORT = process.env.PORT

// TEST VARIABLES THAT CAN BE TWEAKED DURING TESTING
// const NETWORK_DENSITY_PERCENT = 40

// documentation
// https://telegraf.js.org/#/?id=introduction
const bot = new Telegraf(BOT_TOKEN)
const telegram = new Telegram(BOT_TOKEN)

const GROUP_GAMES = {}
const GAMES = {}

// RELOAD in saved game data, from the filesystem
const gamesFolder = path.join(__dirname, '..', 'games')
fs.readdir(gamesFolder, (err, files) => {
  if (err) {
    throw err
  }
  files.forEach((file) => {
    const game = require(path.join(gamesFolder, file))
    GAMES[game.id] = game
  })
})

function groupIsBusy(groupId, gameId) {
  GROUP_GAMES[groupId] = gameId
}
function groupIsFree(groupId) {
  delete GROUP_GAMES[groupId]
}

// save a game to the filesystem as JSON.
// performed after the game ends
function saveGame(gameId) {
  const game = GAMES[gameId]
  if (!game) return
  fs.writeFileSync(
    path.join(__dirname, '..', 'games', `${gameId}.json`),
    JSON.stringify(game.toJSON())
  )
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
      // a supergroup is a public group
      !(message.chat.type === 'group' || message.chat.type === 'supergroup')
    ) {
      if (noisy) {
        return ctx.reply(
          'Game can only be played in a group setting. Add me to a group'
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
    const gameId = GROUP_GAMES[groupId]
    const game = GAMES[gameId]
    if (!game) {
      if (noisy) {
        return ctx.reply(
          'There is no game in progress in this group. Start one by using /run'
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
  if (GROUP_GAMES[groupId]) {
    return ctx.reply(
      'There is already a game in progress in this group. Finish that one first.'
    )
  }
  // this will transmit events from the telegram bot listeners
  // over an internal channel, where the events are named by the
  // user id who sent the message
  const messageBus = new EventEmitter()
  const game = new Game({ groupId, telegram, messageBus, gameUrl: GAME_URL })
  groupIsBusy(groupId, game.id)
  GAMES[game.id] = game
  return ctx.reply(
    `Who wants to play? reply with "me" if you do.
If this is your first time playing, please click this link, @relater_bot , and send the bot any message at all before returning here.
Run the /ready command when you want to start. Players will still be able to join.`
  )
})

// the /ready command, start a game that's been initiated and has players
// gameMware will validate that there's a game in progress
function noReadyTwice(ctx, next) {
  const game = ctx.groupGame
  if (game.running) {
    return ctx.reply(
      'There is already a game in progress in this group. Finish that one first.'
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
    `Ok lets play!
Everyone please go to your direct message chat with this bot (@relater_bot) to play.
Players can still join until someone runs /close. 
Run the /end command if you want to end the game early`
  )

  // start the game
  game.startGame(ctx).then(() => {
    // free up the group to play another game
    // once this game ends
    groupIsFree(groupId)
    saveGame(game.id)
  })

  await ctx.reply(
    `View the results now or anytime in your browser by visiting: ${game.gameUrl}?gameId=${game.id}`
  )
})

function onlyIfRunning(ctx, next) {
  const game = ctx.groupGame
  if (!game.running) {
    return ctx.reply(
      'There is no game in progress in this group. Start one first.'
    )
  } else {
    return next()
  }
}
bot.command('close', groupMware(), gameMware(), onlyIfRunning, async (ctx) => {
  await ctx.reply(
    'Registration for the game has been closed. The game will end when everyone completes, or someone runs /end'
  )
  ctx.groupGame.closeRegistration()
})
bot.command('end', groupMware(), gameMware(), onlyIfRunning, async (ctx) => {
  await ctx.reply('The game has been drawn to an end. Thanks for playing')
  ctx.groupGame.endGame()
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
  Object.values(GAMES).forEach((game) => {
    // prevent it from trying to send messages to
    // past games
    if (game.messageBus) {
      game.messageBus.emit(userId, ctx)
    }
  })
})

// handle a request to "play the game" by
// sending back the live URL of the HTML game
bot.gameQuery(async (ctx) => {
  // const groupId = ctx.update.callback_query.message.chat.id
  let result
  try {
    result = await ctx.answerCbQuery(null, null, {
      // TODO find a way to get gameId in here
      url: `${GAME_URL}?gameId=`,
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
  app.get('/data/default-test', async (req, res) => {
    // const game = new Game({
    //   groupId: '123',
    //   telegram,
    //   messageBus,
    //   gameUrl: GAME_URL,
    // })
    // // everyones responses
    // const densityPercentage = NETWORK_DENSITY_PERCENT
    // game.edges = generateTestEdges(game, densityPercentage)

    // // convert game data to cytoscape format
    // const cytoscapeData = await convertGameDataToCytoscape(telegram, game)
    const cytoscapeData = require('./rsf-flow-metacaugs.json')

    // send the data back as the response to the http request
    res.send(cytoscapeData)
  })
}

// DATA fetcher endpoint, where the data from a game, for a group,
// is formatted to cytoscape friendly format
app.get('/data/:gameId', async (req, res) => {
  const { gameId } = req.params

  const game = GAMES[gameId]
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
