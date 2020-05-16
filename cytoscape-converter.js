function getPlayerName(playerData) {
  const firstName = playerData.first_name ? playerData.first_name : ''
  const lastName = playerData.last_name ? playerData.last_name : ''
  const username = playerData.username ? playerData.username : ''
  return `${firstName} ${lastName} (${username})`
}

function convertGameDataToCytoscape(gameInstance) {
  let cytoscapeData = {
    nodes: gameInstance.players.map((playerId) => {
      const playerData = gameInstance.playerData[playerId]
      return {
        data: {
          id: playerId,
          name: getPlayerName(playerData),
        },
      }
    }),
    // since its an array of arrays, use `.flat()` to draw all data points
    // up into one single, flat, array
    edges: gameInstance.data.flat().map((d, index) => ({
      data: {
        // lesson learned, id for edges should not overlap with ids for nodes
        id: 'edge' + index,
        source: d.playerAsked.id,
        target: d.playerAskedAbout.id,
        strength: d.strength,
        playerAskedAboutName: getPlayerName(d.playerAskedAbout),
        playerAskedName: getPlayerName(d.playerAsked),
      },
    })),
  }

  return cytoscapeData
}

module.exports = convertGameDataToCytoscape
