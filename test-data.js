function generateTestDataItem(num) {
  return {
    id: num,
    first_name: 'Agent',
    last_name: num,
    username: 'agent' + num,
    test: true,
  }
}

function generateTestPlayerData(count) {
  const testData = {
    players: [],
    playerData: {},
  }

  for (let i = 1; i <= count; i++) {
    const item = generateTestDataItem(i)
    testData.players.push(item.id)
    testData.playerData[item.id] = item
  }

  return testData
}

// [
//   // someones responses
//   [
//     {
//       playerAsked: gameInstance.playerData[gameInstance.players[0]],
//       playerAskedAbout: gameInstance.playerData[gameInstance.players[1]],
//       strength: 0.4,
//     },
//   ],
//   // someone elses responses
//   [
//     {
//       playerAsked: gameInstance.playerData[gameInstance.players[1]],
//       playerAskedAbout: gameInstance.playerData[gameInstance.players[0]],
//       strength: 0.7,
//     },
//   ],
// ]

function generateTestEdges(gameInstance, density) {
  if (density > 100 || density < 0) {
    throw new Error('density is a percentage and must be between 0 and 100')
  }
  // results to be stored in here
  const edges = []
  // const otherPlayersCount = gameInstance.players.length - 1
  const densityAsDecimal = density / 100
  const edgeCount = Math.floor(gameInstance.players.length * densityAsDecimal)

  for (let i = 0; i < gameInstance.players.length; i++) {
    // create an array of responses, per each person in the network
    const playersEdges = []
    // depending on the desired network density, fill in the edges
    // to other nodes
    const playerAskedId = gameInstance.players[i]
    const playerAsked = gameInstance.playerData[playerAskedId]
    // create an edge between all nodes that aren't oneself, within the desired network density
    for (let j = 0; j < edgeCount; ) {
      // skip over self, do nothing
      if (j === i) {
        // increment j
        j++
        continue
      }

      const playerAskedAboutId = gameInstance.players[j]
      const playerAskedAbout = gameInstance.playerData[playerAskedAboutId]
      const strength = Math.random().toFixed(2)
      playersEdges.push({
        playerAsked,
        playerAskedAbout,
        strength,
      })
      // increment j
      j++
    }
    edges.push(playersEdges)
  }

  return edges
}

module.exports = {
  generateTestPlayerData,
  generateTestEdges,
}
