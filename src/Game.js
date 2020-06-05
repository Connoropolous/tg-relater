const { once } = require('events')
// const Extra = require('telegraf/extra')
// const Markup = require('telegraf/markup')
const { generateTestPlayerData } = require('./test-data')
const AttentionQueue = require('./AttentionQueue')

// const GAME_SHORT_NAME = process.env.GAME_SHORT_NAME
const TESTING_MODE = process.env.TESTING_MODE === 'true'

// TEST VARIABLES THAT CAN BE TWEAKED DURING TESTING
const NUMBER_OF_TEST_PLAYERS = 5

class Game {
  constructor({ groupId, telegram, messageBus, gameUrl }) {
    // give a random id
    this.id = Math.random().toString().slice(2)
    this.groupId = groupId
    this.telegram = telegram
    this.messageBus = messageBus
    this.gameUrl = gameUrl

    this.messageBus.on('error', (e) => {
      if (e.message === AttentionQueue.REMOTE_QUIT) {
        this.messageBus.emit(Game.USER_END)
      } else {
        throw e
      }
    })

    this.createdAt = Date.now()
    this.startedAt = null
    this.registrationOpen = true
    this.wasEarlyEnded = false
    // where we store results
    this.edges = []

    if (TESTING_MODE) {
      const testPlayerData = generateTestPlayerData(NUMBER_OF_TEST_PLAYERS)
      this.players = testPlayerData.players
      this.playerData = testPlayerData.playerData
    } else {
      this.players = []
      // player data, keyed by player id
      this.playerData = {}
    }
    this.attentionQueues = {}
    this.running = false
  }

  /*
    built-in methods for Game instances
  */
  async playersNextMessageSent(playerId) {
    const [ctx] = await once(this.messageBus, playerId)
    return ctx.message.text
  }

  // callable anytime until registration is closed
  addPlayer(userId, userData) {
    if (this.registrationOpen) {
      userId = typeof userId === 'string' ? userId : userId.toString()
      this.players.push(userId)
      this.playerData[userId] = userData
      this.setupPlayerAttentionQueue(userId, userData)
    }
  }

  setupPlayerAttentionQueue(userId, userData) {
    const handleItem = (playerToAskAbout, remainingCount) =>
      this.playerAndPlayerConnection(userData, playerToAskAbout, remainingCount)
    const attentionQueue = new AttentionQueue(handleItem)

    attentionQueue.on(AttentionQueue.RESULT, (result) => {
      this.edges.push(result)
    })
    // handling when a user completes the current queue
    attentionQueue.on(AttentionQueue.HIT_END_OF_QUEUE, () => {
      if (!this.registrationOpen) {
        // set this one to '!running' so that others
        // will know that it's done if they check
        attentionQueue.stopOrPause()
        if (!this.completeIfNatural()) {
          // not everyone is done, but user is totally done
          const doneForGood =
            'You have completed all of them! The group will be notified when ALL participants have completed.'
          this.telegram.sendMessage(userId, doneForGood)
        } else {
          // if its completely done, and we were the one to end it
          const finishedGame =
            "You were the final participant. Being last isn't bad don't worry!"
          this.telegram.sendMessage(userId, finishedGame)
          attentionQueue.removeAllListeners()
        }
      } else {
        const doneForNow =
          "That's all of them for now! If new people join, you will automatically be asked about them as well."
        this.telegram.sendMessage(userId, doneForNow)
      }
    })
    // handling when the game was ended by a facilitator, or anyone
    attentionQueue.once(AttentionQueue.REMOTE_QUIT, () => {
      attentionQueue.removeAllListeners()
      const message =
        'The game has been drawn to a close and no more responses are being accepted.'
      this.telegram.sendMessage(userId, message)
    })

    // track this attentionQueue under the associated usersId
    this.attentionQueues[userId] = attentionQueue

    // special cases if the game is already running
    if (this.running) {
      // fill up this new persons attention queue immediately
      // this will also start their attention queue
      this.seedAttentionQueue(userId)
      // add this person to everyone elses attention queue
      Object.keys(this.attentionQueues)
        .filter((playerId) => playerId !== userId)
        .forEach((playerId) => {
          this.attentionQueues[playerId].add(userData)
        })
    }
  }

  completeIfNatural() {
    const naturalCompletion =
      this.running &&
      Object.values(this.attentionQueues).every(
        (someoneQueue) => !someoneQueue.running
      )
    if (naturalCompletion) {
      this.messageBus.emit(Game.NATURAL_END)
    }
    return naturalCompletion
  }

  // core 1-on-1 interaction to ask about how well someone knows someone else
  async playerAndPlayerConnection(
    playerToAsk,
    playerToAskAbout,
    numberRemaining
  ) {
    const otherPlayersName = playerToAskAbout.first_name
    await this.telegram.sendMessage(
      playerToAsk.id,
      `How well do you know ${otherPlayersName} (@${playerToAskAbout.username})?

Use the following guide to assign a number to your connection:

Type in the highest number that you would say is true about your connection, and send as a reply to this message

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

(${numberRemaining} remaining)`
    )

    // be able to share an anecdote by voice or text of
    // how you first connected

    // listen for specific responses, and associate a response with a
    // question, validate them and loop indefinitely till we
    // get a valid response
    let invalidResponse = true
    let response
    while (invalidResponse) {
      response = await this.playersNextMessageSent(playerToAsk.id)
      let parsed = Number.parseInt(response)
      if (parsed >= 0 && parsed <= 9) {
        // this will break us out of the `while` loop
        invalidResponse = false
      } else {
        // invalid response, so message them, and loop back to the start
        await this.telegram.sendMessage(
          playerToAsk.id,
          "That wasn't a valid response. Try again with a number between 0 and 9."
        )
      }
    }

    // multiply it down to a decimal
    let alteredResponse = (response / 9).toFixed(2)

    // create a connection object to return, like an edge in the graph
    return {
      playerAsked: playerToAsk,
      playerAskedAbout: playerToAskAbout,
      strength: alteredResponse,
    }
  }

  seedAttentionQueue(userId) {
    const attentionQueue = this.attentionQueues[userId]
    const otherPlayers = this.players.filter((playerId) => playerId !== userId)
    otherPlayers.forEach((playerId) => {
      const playerToAskAbout = this.playerData[playerId]
      attentionQueue.add(playerToAskAbout)
    })
    attentionQueue.startOrResume()
  }

  async startGame(ctx) {
    this.running = true
    this.startedAt = Date.now()

    // ask every player in PARALLEL about other players
    Object.keys(this.attentionQueues).forEach(
      this.seedAttentionQueue.bind(this)
    )

    // whichever comes first
    await Promise.race([
      once(this.messageBus, Game.USER_END),
      once(this.messageBus, Game.NATURAL_END),
    ])

    // remove any lingering event listeners, which will cause memory leaks
    Object.values(this.attentionQueues).forEach((attentionQueue) =>
      attentionQueue.removeAllListeners()
    )

    this.endedAt = Date.now()

    // will be true if this.endGame() was called
    if (!this.wasEarlyEnded) {
      // it has everyones responses to all connections
      await ctx.reply(
        "Everyone has completed! Thanks for playing. Don't forget to check out the results."
      )
    }

    // const buttons = Extra.markup(
    //   Markup.inlineKeyboard([Markup.gameButton('Show graph')])
    // )
    // await ctx.replyWithGame(GAME_SHORT_NAME, buttons)
  }

  closeRegistration() {
    this.registrationOpen = false
    // at this point, anyone who is complete
    // can be marked as !running because there won't be any more
    // this will enforce that completeIfNatural works as expected
    Object.values(this.attentionQueues).forEach((attentionQueue) => {
      if (attentionQueue.ready.length === 0) {
        attentionQueue.stopOrPause()
      }
    })
    this.completeIfNatural()
  }

  endGame() {
    if (!this.running) return
    this.wasEarlyEnded = true
    // end a running game, by canceling all the pending event listeners
    // which will cause them to end a chain of promises due to being an undefined result
    this.messageBus.emit('error', new Error(AttentionQueue.REMOTE_QUIT))
  }

  toJSON() {
    return {
      id: this.id,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      groupId: this.groupId,
      registrationOpen: this.registrationOpen,
      wasEarlyEnded: this.wasEarlyEnded,
      running: this.running,
      players: this.players,
      playerData: this.playerData,
      edges: this.edges,
    }
  }
}

Game.NATURAL_END = 'natural_end'
Game.USER_END = 'user_end'

module.exports = Game
