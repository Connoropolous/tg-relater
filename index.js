const Telegraf = require('telegraf')
const Telegram = require('telegraf/telegram')
require('dotenv').config()

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
    this.playerData = {}
  }
  addPlayer(userId, userData) {
    this.players.push(userId)
    this.playerData[userId] = userData
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
  return ctx.reply(
    'ok lets play! everyone please go to your direct message chat with this bot (@relater_bot) and send me a message to initiate'
  )
})

// general text message handler
// in groupMware, fail silently
bot.on('text', groupMware(false), gameMware(false), (ctx) => {
  // only respond to 'me' statements for me, joining in a game
  if (ctx.message.text !== 'me') return

  const game = ctx.groupGame
  const userId = ctx.update.message.from.id
  const user = ctx.update.message.from

  // user.first_name

  if (game.players.indexOf(userId) > -1) {
    return ctx.reply('you are already registered for the game')
  }

  game.addPlayer(userId, user)
  // TODO: make a comment about sending "Me" the bot a DM, to initiate contact
  return ctx.reply('added you to the game')
})

// setInterval(() => {
//   // 288989141
//   // telegram.sendMessage(288989141, 'hi')
// }, 3000)

bot.launch()
