const Extra = require('telegraf/extra')
const Markup = require('telegraf/markup')
const { generateTestPlayerData } = require('./test-data')

const GAME_SHORT_NAME = process.env.GAME_SHORT_NAME
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

    if (TESTING_MODE) {
      const testPlayerData = generateTestPlayerData(NUMBER_OF_TEST_PLAYERS)
      this.players = testPlayerData.players
      this.playerData = testPlayerData.playerData
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
  playersNextMessageSent(playerId) {
    // reassign variable in order to avoid instance
    // reference issue in the inner function
    const messageBus = this.messageBus
    return new Promise((resolve) => {
      messageBus.once(playerId, (ctx) => {
        resolve(ctx.message.text)
      })
    })
  }

  // during setup stage of the game
  addPlayer(userId, userData) {
    this.players.push(userId)
    this.playerData[userId] = userData
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
          "that wasn't a valid response. try again with a number between 0 and 9"
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
    // skip over test players, in terms of asking them
    if (playerToAsk.test) {
      return []
    }

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
    await this.telegram.sendMessage(
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

    const buttons = Extra.markup(
      Markup.inlineKeyboard([Markup.gameButton('Show graph')])
    )
    await ctx.replyWithGame(GAME_SHORT_NAME, buttons)
    return ctx.reply(
      `You can also view the results directly in your browser by visiting: ${this.gameUrl}?groupId=${this.groupId}&gameId=${this.id}`
    )
  }
}

module.exports = Game
